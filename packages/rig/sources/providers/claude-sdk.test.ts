import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { runAgentLoop } from "../agent/loop.js";
import { defineTool } from "../agent/types.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import { validPng32Base64 } from "../tools/testing/validImageFixtures.js";
import {
    modelAnthropicFable5,
    modelAnthropicOpus46,
    modelAnthropicOpus47,
    modelAnthropicOpus48,
    modelAnthropicSonnet5,
    modelAnthropicSonnet46,
    modelAnthropicSonnet461m,
} from "./models.js";
import { createClaudeSdkProvider, type ClaudeSdkQuery } from "./claude-sdk.js";
import type { Context } from "./types.js";

describe("Claude SDK provider", () => {
    it("preserves exhausted-credit classification and reset metadata from the SDK", async () => {
        const harness = createJustBashToolHarness();
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            pathToClaudeCodeExecutable: "/test/claude",
            query: (() =>
                fakeClaudeQuery([
                    {
                        type: "rate_limit_event",
                        rate_limit_info: {
                            status: "rejected",
                            resetsAt: 2_000,
                            overageStatus: "rejected",
                            overageResetsAt: 3_000,
                            overageDisabledReason: "out_of_credits",
                        },
                        uuid: "00000000-0000-4000-8000-000000000017",
                        session_id: "00000000-0000-4000-8000-000000000018",
                    },
                    failedResult(["You're out of extra usage"]),
                ])) as ClaudeSdkQuery,
        });

        const stream = provider.stream(modelAnthropicFable5, {
            messages: [{ role: "user", content: "Use Claude.", timestamp: 1 }],
        });
        for await (const _event of stream) {
            // Drain the stream.
        }

        await expect(stream.result()).resolves.toMatchObject({
            errorMessage: "You're out of extra usage",
            providerError: { resetAt: 2_000_000, type: "out_of_tokens" },
            stopReason: "error",
        });
    });

    it("keeps Claude image constraints under a custom provider key", () => {
        const harness = createJustBashToolHarness();
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            id: "company-claude",
            pathToClaudeCodeExecutable: "/test/claude",
        });

        expect(provider.imageProfile(modelAnthropicOpus48)).toBe("claude");
    });

    it("rejects result when a caller stops consuming the inference stream early", async () => {
        const harness = createJustBashToolHarness();
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            pathToClaudeCodeExecutable: "/test/claude",
            query: (() => fakeClaudeQuery([successfulResult("unused")])) as ClaudeSdkQuery,
        });
        const stream = provider.stream(modelAnthropicFable5, {
            messages: [{ role: "user", content: "Stop after the first event.", timestamp: 1 }],
        });

        for await (const _event of stream) {
            break;
        }

        await expect(stream.result()).rejects.toThrow(
            "Inference stream iteration ended before a result was available.",
        );
    });

    it("maps and caches quota through the documented SDK usage control API", async () => {
        const harness = createJustBashToolHarness();
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        let closes = 0;
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            env: {
                CLAUDE_CODE_ENABLE_TELEMETRY: "1",
                OTEL_LOGS_EXPORTER: "otlp",
            },
            now: () => 1_000,
            pathToClaudeCodeExecutable: "/test/claude",
            query: ((params) => {
                calls.push(params);
                return {
                    close: () => {
                        closes += 1;
                    },
                    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
                        rate_limits_available: true,
                        rate_limits: {
                            five_hour: {
                                utilization: 32,
                                resets_at: "2026-07-15T04:31:00.000Z",
                            },
                        },
                    }),
                };
            }) as ClaudeSdkQuery,
        });

        await expect(provider.quota?.()).resolves.toMatchObject({
            capturedAt: 1_000,
            source: "claude",
            windows: { fiveHour: { status: "available", usedPercent: 32 } },
        });
        await expect(provider.quota?.()).resolves.toMatchObject({
            windows: { fiveHour: { usedPercent: 32 } },
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.options).toMatchObject({
            cwd: harness.context.fs.cwd,
            env: {
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                CLAUDE_CODE_ENABLE_TELEMETRY: "0",
                DISABLE_ERROR_REPORTING: "1",
                DISABLE_TELEMETRY: "1",
                OTEL_LOGS_EXPORTER: "none",
                OTEL_METRICS_EXPORTER: "none",
                OTEL_TRACES_EXPORTER: "none",
            },
            pathToClaudeCodeExecutable: "/test/claude",
            persistSession: false,
            settings: {
                env: {
                    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                    DISABLE_ERROR_REPORTING: "1",
                    DISABLE_TELEMETRY: "1",
                    OTEL_LOGS_EXPORTER: "none",
                    OTEL_METRICS_EXPORTER: "none",
                    OTEL_TRACES_EXPORTER: "none",
                },
            },
            settingSources: [],
        });
        expect(closes).toBe(1);
    });

    it("returns unavailable when the Claude SDK quota probe cannot start", async () => {
        const harness = createJustBashToolHarness();
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            now: () => 1_000,
            query: (() => {
                throw new Error("Claude executable unavailable");
            }) as ClaudeSdkQuery,
        });

        await expect(provider.quota?.()).resolves.toEqual({
            capturedAt: 1_000,
            source: "claude",
            windows: {
                fiveHour: { status: "unavailable" },
                weekly: { status: "unavailable" },
            },
        });
    });

    it("runs Claude Agent SDK with built-in tools disabled and project tools exposed", async () => {
        const harness = createJustBashToolHarness();
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            env: {
                BETA_TRACING_ENDPOINT: "https://telemetry.example.test",
                CLAUDE_CODE_ENABLE_TELEMETRY: "1",
                CLAUDE_CONFIG_DIR: "/test/claude-config",
                ENABLE_BETA_TRACING_DETAILED: "1",
                OTEL_LOGS_EXPORTER: "otlp",
            },
            pathToClaudeCodeExecutable: "/test/claude",
            sessionId: "11111111-1111-4111-8111-111111111111",
            tools: [
                defineTool({
                    name: "Read",
                    label: "Read",
                    description: "Read a file through the project tool.",
                    arguments: Type.Object({
                        path: Type.String({ description: "Path to read." }),
                    }),
                    returnType: Type.Object({
                        text: Type.String(),
                    }),
                    shouldReviewInAutoMode: () => false,
                    execute: async ({ path }) => ({ text: `read ${path}` }),
                    toLLM: (result) => [{ type: "text", text: result.text }],
                    toUI: (result) => result.text,
                    locks: [],
                }),
            ],
            query: ((params) => {
                calls.push(params);
                return fakeClaudeQuery([
                    {
                        type: "result",
                        subtype: "success",
                        duration_ms: 1,
                        duration_api_ms: 1,
                        is_error: false,
                        num_turns: 1,
                        result: "ok",
                        stop_reason: "end_turn",
                        total_cost_usd: 0,
                        usage: {
                            input_tokens: 2,
                            output_tokens: 1,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0,
                            server_tool_use: null,
                            service_tier: null,
                            cache_creation: null,
                        },
                        modelUsage: {},
                        permission_denials: [],
                        uuid: "00000000-0000-4000-8000-000000000001",
                        session_id: "00000000-0000-4000-8000-000000000002",
                    },
                ]);
            }) as ClaudeSdkQuery,
        });
        const context: Context = {
            systemPrompt: "Use project tools.",
            messages: [
                {
                    role: "user",
                    content: "Say ok.",
                    timestamp: 1,
                },
            ],
        };

        const stream = provider.stream(modelAnthropicFable5, context);
        for await (const _event of stream) {
            // Drain the stream.
        }
        const result = await stream.result();

        expect(result.content).toEqual([{ type: "text", text: "ok" }]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.options?.tools).toEqual([]);
        expect(calls[0]?.options?.allowedTools).toEqual(["mcp__rig__Read"]);
        expect(calls[0]?.options?.toolAliases).toBeUndefined();
        expect(calls[0]?.options?.extraArgs).toEqual({ "disable-slash-commands": null });
        expect(calls[0]?.options?.env?.CLAUDE_CODE_DISABLE_BUNDLED_SKILLS).toBe("1");
        expect(calls[0]?.options?.env?.CLAUDE_AGENT_SDK_MCP_NO_PREFIX).toBe("1");
        expect(calls[0]?.options?.env).toMatchObject({
            ANT_OTEL_LOGS_EXPORTER: "none",
            ANT_OTEL_METRICS_EXPORTER: "none",
            ANT_OTEL_TRACES_EXPORTER: "none",
            BETA_TRACING_ENDPOINT: "",
            CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            CLAUDE_CODE_ENABLE_TELEMETRY: "0",
            CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "0",
            CLAUDE_CODE_PERFETTO_TRACE: "0",
            DISABLE_AUTOUPDATER: "1",
            DISABLE_BUG_COMMAND: "1",
            DISABLE_ERROR_REPORTING: "1",
            DISABLE_FEEDBACK_COMMAND: "1",
            DISABLE_TELEMETRY: "1",
            ENABLE_BETA_TRACING_DETAILED: "0",
            ENABLE_ENHANCED_TELEMETRY_BETA: "0",
            FORCE_AUTOUPDATE_PLUGINS: "0",
            OTEL_LOG_TOOL_CONTENT: "0",
            OTEL_LOG_TOOL_DETAILS: "0",
            OTEL_LOG_USER_PROMPTS: "0",
            OTEL_LOGS_EXPORTER: "none",
            OTEL_METRICS_EXPORTER: "none",
            OTEL_SDK_DISABLED: "true",
            OTEL_TRACES_EXPORTER: "none",
        });
        expect(calls[0]?.options?.env?.CLAUDE_CONFIG_DIR).toBe("/test/claude-config");
        expect(calls[0]?.options?.includePartialMessages).toBe(true);
        expect(calls[0]?.options?.maxTurns).toBeUndefined();
        expect(calls[0]?.options?.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("128000");
        expect(calls[0]?.options?.permissionMode).toBe("dontAsk");
        expect(calls[0]?.options?.pathToClaudeCodeExecutable).toBe("/test/claude");
        expect(calls[0]?.options?.persistSession).toBe(false);
        expect(calls[0]?.options?.sessionId).toBe("11111111-1111-4111-8111-111111111111");
        expect(calls[0]?.options?.settingSources).toEqual([]);
        expect(calls[0]?.options?.strictMcpConfig).toBe(true);
        expect(calls[0]?.options?.mcpServers).toHaveProperty("rig");
        expect(calls[0]?.options?.settings).toMatchObject({
            env: {
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                CLAUDE_CODE_ENABLE_TELEMETRY: "0",
                DISABLE_ERROR_REPORTING: "1",
                DISABLE_TELEMETRY: "1",
                OTEL_LOGS_EXPORTER: "none",
                OTEL_METRICS_EXPORTER: "none",
                OTEL_TRACES_EXPORTER: "none",
            },
        });
    });

    it("exposes tools added to the agent after the provider is created", async () => {
        const harness = createJustBashToolHarness();
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            pathToClaudeCodeExecutable: "/test/claude",
            tools: [],
            query: ((params) => {
                calls.push(params);
                return fakeClaudeQuery([successfulResult("ok")]);
            }) as ClaudeSdkQuery,
        });

        await provider
            .stream(modelAnthropicFable5, {
                messages: [{ role: "user", content: "Use the dynamic tool.", timestamp: 1 }],
                tools: [
                    {
                        description: "A dynamically discovered MCP tool.",
                        name: "mcp__docs__search",
                        parameters: Type.Object({ query: Type.String() }),
                    },
                ],
            })
            .result();

        expect(calls[0]?.options?.allowedTools).toEqual(["mcp__rig__mcp__docs__search"]);
    });

    it("streams Claude partial assistant text deltas before the final result", async () => {
        const harness = createJustBashToolHarness();
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            tools: [],
            query: (() =>
                fakeClaudeQuery([
                    {
                        type: "stream_event",
                        event: {
                            type: "content_block_start",
                            index: 0,
                            content_block: { type: "text", text: "", citations: null },
                        },
                        parent_tool_use_id: null,
                        uuid: "00000000-0000-4000-8000-000000000007",
                        session_id: "00000000-0000-4000-8000-000000000008",
                    },
                    {
                        type: "stream_event",
                        event: {
                            type: "content_block_delta",
                            index: 0,
                            delta: { type: "text_delta", text: "hel" },
                        },
                        parent_tool_use_id: null,
                        uuid: "00000000-0000-4000-8000-000000000007",
                        session_id: "00000000-0000-4000-8000-000000000008",
                    },
                    {
                        type: "stream_event",
                        event: {
                            type: "content_block_delta",
                            index: 0,
                            delta: { type: "text_delta", text: "lo" },
                        },
                        parent_tool_use_id: null,
                        uuid: "00000000-0000-4000-8000-000000000007",
                        session_id: "00000000-0000-4000-8000-000000000008",
                    },
                    {
                        type: "stream_event",
                        event: { type: "content_block_stop", index: 0 },
                        parent_tool_use_id: null,
                        uuid: "00000000-0000-4000-8000-000000000007",
                        session_id: "00000000-0000-4000-8000-000000000008",
                    },
                    {
                        type: "result",
                        subtype: "success",
                        duration_ms: 1,
                        duration_api_ms: 1,
                        is_error: false,
                        num_turns: 1,
                        result: "hello",
                        stop_reason: "end_turn",
                        total_cost_usd: 0,
                        usage: {
                            input_tokens: 1,
                            output_tokens: 1,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0,
                            server_tool_use: null,
                            service_tier: null,
                            cache_creation: null,
                        },
                        modelUsage: {},
                        permission_denials: [],
                        uuid: "00000000-0000-4000-8000-000000000009",
                        session_id: "00000000-0000-4000-8000-000000000010",
                    },
                ])) as ClaudeSdkQuery,
        });

        const stream = provider.stream(modelAnthropicFable5, {
            messages: [{ role: "user", content: "Say hello.", timestamp: 1 }],
        });
        const deltas: string[] = [];
        const eventTypes: string[] = [];
        for await (const event of stream) {
            eventTypes.push(event.type);
            if (event.type === "text_delta") {
                deltas.push(event.delta);
            }
        }
        const result = await stream.result();

        expect(eventTypes).toEqual([
            "start",
            "text_start",
            "text_delta",
            "text_delta",
            "text_end",
            "done",
        ]);
        expect(deltas).toEqual(["hel", "lo"]);
        expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    });

    it("returns tool calls and tool results through the shared agent loop", async () => {
        const harness = createJustBashToolHarness();
        let executionCount = 0;
        let queryCount = 0;
        let firstQueryClosed = false;
        let continuationRequest: Parameters<ClaudeSdkQuery>[0] | undefined;
        const readTool = defineTool({
            name: "Read",
            label: "Read",
            description: "Read a file through the project tool.",
            arguments: Type.Object({ path: Type.String() }),
            returnType: Type.Object({ text: Type.String() }),
            shouldReviewInAutoMode: () => false,
            execute: ({ path }) => {
                executionCount += 1;
                return { text: `contents of ${path}` };
            },
            toLLM: ({ text }) => [{ type: "text", text }],
            toUI: ({ text }) => text,
            locks: [],
        });
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            tools: [readTool],
            query: ((params) => {
                queryCount += 1;
                if (queryCount === 1) {
                    return fakeClaudeQuery(
                        [
                            {
                                type: "stream_event",
                                event: {
                                    type: "message_start",
                                    message: {
                                        id: "msg-tool-use",
                                        model: "claude-fable-5",
                                        usage: {
                                            input_tokens: 5,
                                            output_tokens: 0,
                                            cache_creation_input_tokens: 0,
                                            cache_read_input_tokens: 0,
                                        },
                                    },
                                },
                                parent_tool_use_id: null,
                                uuid: "00000000-0000-4000-8000-000000000011",
                                session_id: "00000000-0000-4000-8000-000000000012",
                            },
                            {
                                type: "stream_event",
                                event: {
                                    type: "content_block_start",
                                    index: 0,
                                    content_block: {
                                        type: "tool_use",
                                        id: "tool-read",
                                        name: "mcp__rig__Read",
                                        input: {},
                                    },
                                },
                                parent_tool_use_id: null,
                                uuid: "00000000-0000-4000-8000-000000000011",
                                session_id: "00000000-0000-4000-8000-000000000012",
                            },
                            {
                                type: "stream_event",
                                event: {
                                    type: "content_block_delta",
                                    index: 0,
                                    delta: {
                                        type: "input_json_delta",
                                        partial_json: '{"path":"README',
                                    },
                                },
                                parent_tool_use_id: null,
                                uuid: "00000000-0000-4000-8000-000000000011",
                                session_id: "00000000-0000-4000-8000-000000000012",
                            },
                            {
                                type: "stream_event",
                                event: {
                                    type: "content_block_delta",
                                    index: 0,
                                    delta: { type: "input_json_delta", partial_json: '.md"}' },
                                },
                                parent_tool_use_id: null,
                                uuid: "00000000-0000-4000-8000-000000000011",
                                session_id: "00000000-0000-4000-8000-000000000012",
                            },
                            {
                                type: "stream_event",
                                event: { type: "content_block_stop", index: 0 },
                                parent_tool_use_id: null,
                                uuid: "00000000-0000-4000-8000-000000000011",
                                session_id: "00000000-0000-4000-8000-000000000012",
                            },
                            {
                                type: "stream_event",
                                event: {
                                    type: "message_delta",
                                    delta: { stop_reason: "tool_use", stop_sequence: null },
                                    usage: { output_tokens: 4 },
                                },
                                parent_tool_use_id: null,
                                uuid: "00000000-0000-4000-8000-000000000011",
                                session_id: "00000000-0000-4000-8000-000000000012",
                            },
                            {
                                type: "stream_event",
                                event: { type: "message_stop" },
                                parent_tool_use_id: null,
                                uuid: "00000000-0000-4000-8000-000000000011",
                                session_id: "00000000-0000-4000-8000-000000000012",
                            },
                        ],
                        { onClose: () => (firstQueryClosed = true) },
                    );
                }

                continuationRequest = params;
                return fakeClaudeQuery([
                    {
                        type: "result",
                        subtype: "success",
                        duration_ms: 1,
                        duration_api_ms: 1,
                        is_error: false,
                        num_turns: 1,
                        result: "Finished.",
                        stop_reason: "end_turn",
                        total_cost_usd: 0,
                        usage: {
                            input_tokens: 8,
                            output_tokens: 2,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0,
                            server_tool_use: null,
                            service_tier: null,
                            cache_creation: null,
                        },
                        modelUsage: {},
                        permission_denials: [],
                        uuid: "00000000-0000-4000-8000-000000000013",
                        session_id: "00000000-0000-4000-8000-000000000014",
                    },
                ]);
            }) as ClaudeSdkQuery,
        });
        const eventTypes: string[] = [];

        const result = await runAgentLoop({
            provider,
            modelId: modelAnthropicFable5.id,
            tools: [readTool],
            instructions: "Use the available tools.",
            messages: [
                {
                    role: "user",
                    id: "user-1",
                    blocks: [{ type: "text", text: "Read README.md." }],
                },
            ],
            context: harness.context,
            onEvent: (event) => {
                eventTypes.push(event.type);
            },
        });

        expect(firstQueryClosed).toBe(true);
        expect(executionCount).toBe(1);
        expect(queryCount).toBe(2);
        expect(eventTypes).toContain("toolcall_start");
        expect(eventTypes).toContain("toolcall_delta");
        expect(eventTypes).toContain("toolcall_end");
        const continuationMessages = await collectPromptMessages(continuationRequest?.prompt);
        const continuationContent = continuationMessages[0]?.message.content;
        if (!Array.isArray(continuationContent)) {
            throw new Error("Expected structured continuation content.");
        }
        expect(continuationContent).toEqual([
            {
                type: "tool_result",
                tool_use_id: "tool-read",
                content: [{ type: "text", text: "contents of README.md" }],
            },
        ]);
        const replayEntries = await loadReplayEntries(continuationRequest);
        expect(replayEntries.map((entry) => entry.type)).toEqual(["user", "assistant"]);
        expect(replayEntries[0]?.message).toMatchObject({
            role: "user",
            content: [{ type: "text", text: "Read README.md." }],
        });
        expect(replayEntries[1]?.message).toMatchObject({
            role: "assistant",
            content: [
                {
                    type: "tool_use",
                    id: "tool-read",
                    name: "Read",
                    input: { path: "README.md" },
                },
            ],
        });
        expect(result.stopReason).toBe("stop");
        expect(result.messages).toHaveLength(4);
        expect(result.messages[1]).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_call",
                    id: "tool-read",
                    name: "Read",
                    arguments: { path: "README.md" },
                },
            ],
        });
        expect(result.messages[2]).toMatchObject({
            role: "agent",
            blocks: [
                {
                    type: "tool_result",
                    toolCallId: "tool-read",
                    toolName: "Read",
                    rendered: [{ type: "text", text: "contents of README.md" }],
                },
            ],
        });
        expect(result.messages[3]).toMatchObject({
            role: "agent",
            blocks: [{ type: "text", text: "Finished." }],
        });
    });

    it("replays real wire messages as an append-only cacheable prefix", async () => {
        const harness = createJustBashToolHarness();
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            tools: [],
            query: ((params) => {
                calls.push(params);
                return fakeClaudeQuery([successfulResult("done")]);
            }) as ClaudeSdkQuery,
        });
        const firstContext: Context = {
            messages: [
                { role: "user", content: "Search the repository.", timestamp: 1 },
                {
                    role: "assistant",
                    content: [
                        {
                            type: "toolCall",
                            id: "grep-1",
                            name: "Grep",
                            arguments: { pattern: "needle" },
                        },
                    ],
                    api: "claude-agent-sdk",
                    provider: "claude",
                    model: "anthropic/fable-5",
                    usage: emptyUsage(),
                    stopReason: "toolUse",
                    timestamp: 2,
                },
                {
                    role: "toolResult",
                    toolCallId: "grep-1",
                    toolName: "Grep",
                    content: [{ type: "text", text: "first result" }],
                    isError: false,
                    timestamp: 3,
                },
            ],
        };
        const secondContext: Context = {
            messages: [
                ...firstContext.messages,
                {
                    role: "assistant",
                    content: [
                        {
                            type: "toolCall",
                            id: "grep-2",
                            name: "Grep",
                            arguments: { pattern: "second" },
                        },
                    ],
                    api: "claude-agent-sdk",
                    provider: "claude",
                    model: "anthropic/fable-5",
                    usage: emptyUsage(),
                    stopReason: "toolUse",
                    timestamp: 4,
                },
                {
                    role: "toolResult",
                    toolCallId: "grep-2",
                    toolName: "Grep",
                    content: [{ type: "text", text: "second result" }],
                    isError: false,
                    timestamp: 5,
                },
            ],
        };

        await provider.stream(modelAnthropicFable5, firstContext).result();
        await provider.stream(modelAnthropicFable5, secondContext).result();

        const firstEntries = await loadReplayEntries(calls[0]);
        const secondEntries = await loadReplayEntries(calls[1]);
        expect(calls[0]?.options).toMatchObject({
            persistSession: true,
            resume: expect.any(String),
        });
        expect(calls[0]?.options?.sessionId).toBeUndefined();
        expect(secondEntries.slice(0, firstEntries.length)).toEqual(firstEntries);
        expect(firstEntries.map((entry) => entry.type)).toEqual(["user", "assistant"]);
        expect(secondEntries.map((entry) => entry.type)).toEqual([
            "user",
            "assistant",
            "user",
            "assistant",
        ]);
        expect(firstEntries[1]?.message).toMatchObject({
            role: "assistant",
            content: [
                {
                    type: "tool_use",
                    id: "grep-1",
                    name: "Grep",
                    input: { pattern: "needle" },
                },
            ],
        });
        expect(secondEntries[2]?.message).toMatchObject({
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: "grep-1",
                    content: [{ type: "text", text: "first result" }],
                },
            ],
        });
        const secondPrompt = await collectPromptMessages(calls[1]?.prompt);
        expect(secondPrompt[0]?.message).toEqual({
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: "grep-2",
                    content: [{ type: "text", text: "second result" }],
                },
            ],
        });
    });

    it("compacts from the real cached wire history with tools disabled", async () => {
        const harness = createJustBashToolHarness();
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            tools: [],
            query: ((params) => {
                calls.push(params);
                return fakeClaudeQuery([successfulResult("Continuation brief")]);
            }) as ClaudeSdkQuery,
        });
        const context: Context = {
            systemPrompt: "Stable system prompt.",
            messages: [
                { role: "user", content: "Search the repository.", timestamp: 1 },
                {
                    role: "assistant",
                    content: [
                        {
                            type: "toolCall",
                            id: "grep-1",
                            name: "Grep",
                            arguments: { pattern: "needle" },
                        },
                    ],
                    api: "claude-agent-sdk",
                    provider: "claude",
                    model: "anthropic/fable-5",
                    usage: emptyUsage(),
                    stopReason: "toolUse",
                    timestamp: 2,
                },
                {
                    role: "toolResult",
                    toolCallId: "grep-1",
                    toolName: "Grep",
                    content: [{ type: "text", text: "first result" }],
                    isError: false,
                    timestamp: 3,
                },
            ],
        };

        const stream = provider.compact?.(modelAnthropicFable5, context, {
            prompt: "Create a detailed continuation brief.",
            timestamp: 4,
        });
        expect(stream).toBeDefined();
        await stream?.result();

        const entries = await loadReplayEntries(calls[0]);
        const prompt = await collectPromptMessages(calls[0]?.prompt);
        expect(entries.map((entry) => entry.type)).toEqual(["user", "assistant", "user"]);
        expect(entries[1]?.message).toMatchObject({
            role: "assistant",
            content: [
                {
                    type: "tool_use",
                    id: "grep-1",
                    name: "Grep",
                    input: { pattern: "needle" },
                },
            ],
        });
        expect(entries[2]?.message).toMatchObject({
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: "grep-1",
                    content: [{ type: "text", text: "first result" }],
                },
            ],
        });
        expect(prompt).toHaveLength(1);
        expect(prompt[0]?.message).toEqual({
            role: "user",
            content: "Create a detailed continuation brief.",
        });
        expect(calls[0]?.options).toMatchObject({
            maxTurns: 1,
            systemPrompt: "Stable system prompt.",
        });
        expect(calls[0]?.options?.canUseTool).toEqual(expect.any(Function));
    });

    it("maps latest Anthropic catalog models and reasoning effort to Claude SDK options", async () => {
        const harness = createJustBashToolHarness();
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            tools: [],
            query: ((params) => {
                calls.push(params);
                return fakeClaudeQuery([
                    {
                        type: "result",
                        subtype: "success",
                        duration_ms: 1,
                        duration_api_ms: 1,
                        is_error: false,
                        num_turns: 1,
                        result: "ok",
                        stop_reason: "end_turn",
                        total_cost_usd: 0,
                        usage: {
                            input_tokens: 1,
                            output_tokens: 1,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0,
                            server_tool_use: null,
                            service_tier: null,
                            cache_creation: null,
                        },
                        modelUsage: {},
                        permission_denials: [],
                        uuid: "00000000-0000-4000-8000-000000000005",
                        session_id: "00000000-0000-4000-8000-000000000006",
                    },
                ]);
            }) as ClaudeSdkQuery,
        });

        await provider
            .stream(
                modelAnthropicSonnet5,
                { messages: [{ role: "user", content: "Say ok.", timestamp: 1 }] },
                { thinking: "xhigh" },
            )
            .result();
        await provider
            .stream(
                modelAnthropicSonnet5,
                { messages: [{ role: "user", content: "Use ultracode.", timestamp: 2 }] },
                { thinking: "ultra" },
            )
            .result();
        await provider
            .stream(modelAnthropicOpus48, {
                messages: [{ role: "user", content: "Say ok.", timestamp: 3 }],
            })
            .result();
        await provider
            .stream(modelAnthropicFable5, {
                messages: [{ role: "user", content: "Say ok.", timestamp: 4 }],
            })
            .result();
        await provider
            .stream(modelAnthropicOpus47, {
                messages: [{ role: "user", content: "Say ok.", timestamp: 5 }],
            })
            .result();
        await provider
            .stream(modelAnthropicOpus46, {
                messages: [{ role: "user", content: "Say ok.", timestamp: 6 }],
            })
            .result();
        await provider
            .stream(modelAnthropicSonnet461m, {
                messages: [{ role: "user", content: "Say ok.", timestamp: 7 }],
            })
            .result();
        await provider
            .stream(modelAnthropicSonnet46, {
                messages: [{ role: "user", content: "Say ok.", timestamp: 8 }],
            })
            .result();

        expect(calls[0]?.options?.model).toBe("sonnet[1m]");
        expect(calls[0]?.options?.effort).toBe("xhigh");
        expect(calls[0]?.options?.thinking).toEqual({
            type: "adaptive",
            display: "summarized",
        });
        expect(calls[1]?.options?.model).toBe("sonnet[1m]");
        expect(calls[1]?.options?.effort).toBe("xhigh");
        expect(calls[1]?.options?.thinking).toEqual({
            type: "adaptive",
            display: "summarized",
        });
        expect(calls[1]?.options?.env?.CLAUDE_CODE_EFFORT_LEVEL).toBe("ultracode");
        expect(calls[2]?.options?.model).toBe("opus[1m]");
        expect(calls[3]?.options?.model).toBe("claude-fable-5[1m]");
        expect(calls[4]?.options?.model).toBe("claude-opus-4-7[1m]");
        expect(calls[5]?.options?.model).toBe("claude-opus-4-6[1m]");
        expect(calls[6]?.options?.model).toBe("claude-sonnet-4-6[1m]");
        expect(calls[7]?.options?.model).toBe("claude-sonnet-4-6");
    });

    it("resolves a result when callers do not consume stream events", async () => {
        const harness = createJustBashToolHarness();
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            tools: [],
            query: (() =>
                fakeClaudeQuery([
                    {
                        type: "result",
                        subtype: "success",
                        duration_ms: 1,
                        duration_api_ms: 1,
                        is_error: false,
                        num_turns: 1,
                        result: "done",
                        stop_reason: "end_turn",
                        total_cost_usd: 0,
                        usage: {
                            input_tokens: 1,
                            output_tokens: 1,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: 0,
                            server_tool_use: null,
                            service_tier: null,
                            cache_creation: null,
                        },
                        modelUsage: {},
                        permission_denials: [],
                        uuid: "00000000-0000-4000-8000-000000000003",
                        session_id: "00000000-0000-4000-8000-000000000004",
                    },
                ])) as ClaudeSdkQuery,
        });

        const result = await provider
            .stream(modelAnthropicFable5, {
                messages: [{ role: "user", content: "Finish.", timestamp: 1 }],
            })
            .result();

        expect(result.content).toEqual([{ type: "text", text: "done" }]);
    });

    it("keeps images as native blocks when rebuilding a multi-turn prompt", async () => {
        const harness = createJustBashToolHarness();
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        const provider = createClaudeSdkProvider({
            agentContext: harness.context,
            tools: [],
            query: ((params) => {
                calls.push(params);
                return fakeClaudeQuery([successfulResult("done")]);
            }) as ClaudeSdkQuery,
        });

        await provider
            .stream(modelAnthropicFable5, {
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Inspect this: " },
                            {
                                type: "image",
                                mimeType: "image/png",
                                data: validPng32Base64,
                            },
                        ],
                        timestamp: 1,
                    },
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "toolCall",
                                id: "image-result",
                                name: "view_image",
                                arguments: { path: "/tmp/image.png" },
                            },
                        ],
                        api: "claude-agent-sdk",
                        provider: "claude",
                        model: "anthropic/fable-5",
                        usage: emptyUsage(),
                        stopReason: "toolUse",
                        timestamp: 2,
                    },
                    {
                        role: "toolResult",
                        toolCallId: "image-result",
                        toolName: "view_image",
                        content: [
                            {
                                type: "image",
                                mimeType: "image/png",
                                data: validPng32Base64,
                            },
                        ],
                        isError: false,
                        timestamp: 3,
                    },
                    {
                        role: "user",
                        content: "What do both images show?",
                        timestamp: 4,
                    },
                ],
            })
            .result();

        const promptMessages = await collectPromptMessages(calls[0]?.prompt);
        expect(promptMessages).toHaveLength(1);
        expect(promptMessages[0]?.message).toEqual({
            role: "user",
            content: "What do both images show?",
        });
        const replayEntries = await loadReplayEntries(calls[0]);
        const replayImages = replayEntries.flatMap((entry) => {
            const message = entry.message as { content?: unknown } | undefined;
            if (!Array.isArray(message?.content)) return [];
            return message.content.flatMap((block: unknown) => {
                if (typeof block !== "object" || block === null) return [];
                if ((block as { type?: unknown }).type === "image") return [block];
                if ((block as { type?: unknown }).type !== "tool_result") return [];
                const content = (block as { content?: unknown }).content;
                return Array.isArray(content)
                    ? content.filter(
                          (item) =>
                              typeof item === "object" &&
                              item !== null &&
                              (item as { type?: unknown }).type === "image",
                      )
                    : [];
            });
        });
        expect(replayImages).toEqual([
            {
                type: "image",
                source: {
                    type: "base64",
                    media_type: "image/png",
                    data: validPng32Base64,
                },
            },
            {
                type: "image",
                source: {
                    type: "base64",
                    media_type: "image/png",
                    data: validPng32Base64,
                },
            },
        ]);
    });
});

async function collectPromptMessages(prompt: Parameters<ClaudeSdkQuery>[0]["prompt"] | undefined) {
    if (prompt === undefined || typeof prompt === "string") {
        throw new Error("Expected a structured Claude SDK prompt.");
    }

    const messages = [];
    for await (const message of prompt) {
        messages.push(message);
    }
    return messages;
}

async function loadReplayEntries(request: Parameters<ClaudeSdkQuery>[0] | undefined) {
    const sessionStore = request?.options?.sessionStore;
    const sessionId = request?.options?.resume;
    if (sessionStore === undefined || sessionId === undefined) {
        throw new Error("Expected a Claude session replay store.");
    }
    return (
        ((await sessionStore.load({ projectKey: "test", sessionId })) as Array<{
            message?: unknown;
            type: string;
        }> | null) ?? []
    );
}

function emptyUsage() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
        },
    };
}

function successfulResult(result: string) {
    return {
        type: "result" as const,
        subtype: "success" as const,
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        result,
        stop_reason: "end_turn" as const,
        total_cost_usd: 0,
        usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "00000000-0000-4000-8000-000000000015",
        session_id: "00000000-0000-4000-8000-000000000016",
    };
}

function failedResult(errors: string[]) {
    return {
        type: "result" as const,
        subtype: "error_during_execution" as const,
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: true,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null,
        },
        modelUsage: {},
        permission_denials: [],
        errors,
        uuid: "00000000-0000-4000-8000-000000000019",
        session_id: "00000000-0000-4000-8000-000000000020",
    };
}

function fakeClaudeQuery(messages: readonly unknown[], options: { onClose?: () => void } = {}) {
    const stream = (async function* () {
        for (const message of messages) {
            yield message;
        }
    })();

    return Object.assign(stream, {
        interrupt: async () => {},
        setPermissionMode: async () => {},
        setMcpPermissionModeOverride: async () => ({}),
        setModel: async () => {},
        setMaxThinkingTokens: async () => {},
        applyFlagSettings: async () => {},
        initializationResult: async () => ({}) as never,
        reinitialize: async () => ({}) as never,
        supportedCommands: async () => [],
        supportedModels: async () => [],
        supportedAgents: async () => [],
        mcpServerStatus: async () => [],
        getContextUsage: async () => ({}) as never,
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({}) as never,
        readFile: async () => null,
        reloadPlugins: async () => ({}) as never,
        reloadSkills: async () => ({}) as never,
        accountInfo: async () => ({}),
        rewindFiles: async () => ({}) as never,
        seedReadState: async () => {},
        reconnectMcpServer: async () => {},
        toggleMcpServer: async () => {},
        setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
        streamInput: async () => {},
        stopTask: async () => {},
        backgroundTasks: async () => false,
        close: () => options.onClose?.(),
    });
}
