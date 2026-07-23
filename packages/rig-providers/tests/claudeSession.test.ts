import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";

import { ClaudeAuthTokenCredential } from "@/vendors/claude/ClaudeAuthTokenCredential.js";
import { ClaudeSession, type ClaudeSdkQuery } from "@/vendors/claude/ClaudeSession.js";
import { CLAUDE_SDK_PRIVACY_ENVIRONMENT } from "@/vendors/claude/claudeSdkPrivacyEnvironment.js";
import { collectSessionEvents, textFromSessionEvents } from "./helpers/collectSessionEvents.js";

describe("ClaudeSession", () => {
    it("converts native Claude API retries into Rig retry events", async () => {
        const credential = await ClaudeAuthTokenCredential.tryLoad({ authToken: "test-token" });
        if (credential === null) throw new Error("Expected test credential.");
        const session = new ClaudeSession("retry-session", {
            context: { instructions: "", messages: [] },
            credential,
            cwd: "/tmp/rig-claude-retry-test",
            model: "sonnet[1m]",
            query: ((() => {
                async function* messages() {
                    yield {
                        type: "system",
                        subtype: "api_retry",
                        attempt: 2,
                        max_retries: 10,
                        retry_delay_ms: 1_500,
                        error_status: 529,
                        error: "overloaded",
                        uuid: "retry-id",
                        session_id: "retry-session",
                    };
                    yield* fakeQuery("RETRIED");
                }
                const generator = messages();
                return Object.assign(generator, { close: () => {} });
            }) as unknown) as ClaudeSdkQuery,
            skills: [],
            tools: [],
        });

        const events = await collectSessionEvents(
            session.run({ context: { messages: [{ role: "user", content: "Retry." }] } }),
        );

        expect(events).toContainEqual({
            type: "retrying",
            attempt: 2,
            reason: "Claude API overloaded (HTTP 529); retrying in 1.5 s, attempt 2 of 10.",
        });
    });

    it("marks trailing tool results complete before requesting continuation", async () => {
        let capturedPrompt: unknown;
        let capturedEntries: unknown;
        const credential = await ClaudeAuthTokenCredential.tryLoad({ authToken: "test-token" });
        if (credential === null) throw new Error("Expected test credential.");
        const session = new ClaudeSession("tool-result-session", {
            context: { instructions: "", messages: [] },
            credential,
            cwd: "/tmp/rig-claude-tool-result-test",
            model: "sonnet[1m]",
            query: ((parameters) => {
                async function* messages() {
                    capturedEntries = await parameters.options?.sessionStore?.load({
                        projectKey: "test",
                        sessionId: parameters.options.resume ?? "tool-result-session",
                    });
                    if (typeof parameters.prompt !== "string") {
                        capturedPrompt = (
                            await parameters.prompt[Symbol.asyncIterator]().next()
                        ).value;
                    }
                    yield* fakeQuery("TOOL_OK");
                }
                const generator = messages();
                return Object.assign(generator, { close: () => {} });
            }) as ClaudeSdkQuery,
            skills: [],
            tools: [],
        });

        await collectSessionEvents(
            session.run({
                context: {
                    messages: [
                        {
                            role: "assistant",
                            content: "",
                            toolCalls: [{ callId: "call-1", name: "Read", arguments: "{}" }],
                        },
                        { role: "tool", callId: "call-1", content: "TOOL_RESULT" },
                    ],
                },
            }),
        );

        expect(capturedEntries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "user",
                    isMeta: true,
                    message: {
                        role: "user",
                        content: [
                            {
                                type: "tool_result",
                                tool_use_id: "call-1",
                                content: "TOOL_RESULT",
                            },
                        ],
                    },
                }),
            ]),
        );
        expect(capturedPrompt).toMatchObject({
            type: "user",
            message: { content: "Continue from the supplied tool result." },
        });
    });

    it("removes the abort listener when SDK query construction throws", async () => {
        const credential = await ClaudeAuthTokenCredential.tryLoad({ authToken: "test-token" });
        if (credential === null) throw new Error("Expected test credential.");
        const abortController = new AbortController();
        const addAbortListener = vi.spyOn(abortController.signal, "addEventListener");
        const removeAbortListener = vi.spyOn(abortController.signal, "removeEventListener");
        const session = new ClaudeSession("throwing-session", {
            context: { instructions: "", messages: [] },
            credential,
            cwd: "/tmp/rig-claude-throwing-test",
            model: "sonnet[1m]",
            query: (() => {
                throw new Error("SDK construction failed.");
            }) as ClaudeSdkQuery,
            skills: [],
            tools: [],
        });

        await expect(
            collectSessionEvents(
                session.run({
                    abort: abortController.signal,
                    context: { messages: [{ role: "user", content: "Hello." }] },
                }),
            ),
        ).rejects.toThrow(
            "SDK construction failed.",
        );
        expect(addAbortListener).toHaveBeenCalledOnce();
        expect(removeAbortListener).toHaveBeenCalledOnce();
    });

    it("replays user and tool-result images as native Claude image blocks", async () => {
        const captured: {
            entries?: unknown;
            prompt?: unknown;
        } = {};
        const credential = await ClaudeAuthTokenCredential.tryLoad({ authToken: "test-token" });
        if (credential === null) throw new Error("Expected test credential.");
        const session = new ClaudeSession("image-session", {
            context: { instructions: "", messages: [] },
            credential,
            cwd: "/tmp/rig-claude-image-test",
            model: "sonnet[1m]",
            query: ((parameters) => {
                async function* messages() {
                    captured.entries = await parameters.options?.sessionStore?.load({
                        projectKey: "test",
                        sessionId: parameters.options.resume ?? "image-session",
                    });
                    if (typeof parameters.prompt !== "string") {
                        captured.prompt = (
                            await parameters.prompt[Symbol.asyncIterator]().next()
                        ).value;
                    }
                    yield* fakeQuery("IMAGE_OK");
                }
                const generator = messages();
                return Object.assign(generator, { close: () => {} });
            }) as ClaudeSdkQuery,
            skills: [],
            tools: [],
        });

        await collectSessionEvents(
            session.run({
                context: {
                    messages: [
                        {
                            role: "assistant",
                            content: "",
                            toolCalls: [{ callId: "call-1", name: "Read", arguments: "{}" }],
                        },
                        {
                            role: "tool",
                            callId: "call-1",
                            content: "tool image",
                            input: [
                                { type: "text", text: "tool image" },
                                {
                                    type: "image",
                                    mimeType: "image/png",
                                    data: "dG9vbC1pbWFnZQ==",
                                },
                            ],
                        },
                        {
                            role: "user",
                            content: "user image",
                            input: [
                                { type: "text", text: "user image" },
                                {
                                    type: "image",
                                    mimeType: "image/webp",
                                    data: "dXNlci1pbWFnZQ==",
                                },
                            ],
                        },
                    ],
                },
            }),
        );

        expect(captured.entries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "user",
                    message: {
                        role: "user",
                        content: [
                            expect.objectContaining({
                                type: "tool_result",
                                content: [
                                    { type: "text", text: "tool image" },
                                    {
                                        type: "image",
                                        source: {
                                            type: "base64",
                                            media_type: "image/png",
                                            data: "dG9vbC1pbWFnZQ==",
                                        },
                                    },
                                ],
                            }),
                        ],
                    },
                }),
            ]),
        );
        expect(captured.prompt).toMatchObject({
            type: "user",
            message: {
                content: [
                    { type: "text", text: "user image" },
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: "image/webp",
                            data: "dXNlci1pbWFnZQ==",
                        },
                    },
                ],
            },
        });
    });

    it("replaces disabled Claude Code attachments with Rig context, tools, and skills", async () => {
        const calls: Parameters<ClaudeSdkQuery>[0][] = [];
        const compactionPrompts: string[] = [];
        const replies = ["FIRST", "SWITCHED"];
        const credential = await ClaudeAuthTokenCredential.tryLoad({ authToken: "test-token" });
        if (credential === null) throw new Error("Expected test credential.");
        const session = new ClaudeSession("session-id", {
            context: {
                instructions: "Rig system instructions.",
                messages: [{ role: "system", content: "Project instructions." }],
            },
            credential,
            cwd: "/tmp/rig-claude-test",
            env: {
                PATH: process.env.PATH,
                ANTHROPIC_API_KEY: "wrong-api-key",
                CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: "3",
                CLAUDE_CODE_OAUTH_TOKEN: "wrong-oauth-token",
                CLAUDE_CODE_MAX_RETRIES: "2",
                CLAUDE_CODE_USE_BEDROCK: "1",
                CLAUDE_CODE_USE_FOUNDRY: "1",
                CLAUDE_CODE_USE_VERTEX: "1",
                DISABLE_AUTO_COMPACT: "0",
                OTEL_LOG_USER_PROMPTS: "1",
            },
            model: "opus[1m]",
            query: ((parameters) => {
                calls.push(parameters);
                return calls.length >= 3
                    ? fakeNativeCompactQuery(
                          parameters,
                          calls.length === 3 ? "SUMMARY" : "CUSTOM SUMMARY",
                          compactionPrompts,
                      )
                    : fakeQuery(replies[calls.length - 1] ?? "OK");
            }) as ClaudeSdkQuery,
            skills: [
                {
                    name: "golden",
                    description: "Golden skill description.",
                    source: "file",
                    location: "/skills/golden/SKILL.md",
                },
            ],
            tools: [
                {
                    name: "Read",
                    type: "local",
                    description: "Read a file.",
                    parameters: Type.Object({ path: Type.String() }),
                },
            ],
        });

        const abortController = new AbortController();
        const addAbortListener = vi.spyOn(abortController.signal, "addEventListener");
        const removeAbortListener = vi.spyOn(abortController.signal, "removeEventListener");
        const first = await collectSessionEvents(
            session.run({
                abort: abortController.signal,
                context: { messages: [{ role: "user", content: "First turn." }] },
            }),
        );
        const switched = await collectSessionEvents(
            session.run({
                model: "sonnet[1m]",
                context: {
                    messages: [
                        { role: "user", content: "First turn." },
                        { role: "assistant", content: "FIRST" },
                        { role: "user", content: "Switch models." },
                    ],
                },
            }),
        );
        const compacted = await session.compact();
        const customCompacted = await session.compact({
            instructions: "Keep CUSTOM_MARKER.",
        });

        expect(textFromSessionEvents(first)).toBe("FIRST");
        expect(textFromSessionEvents(switched)).toBe("SWITCHED");
        expect(compacted).toMatchObject({
            status: "completed",
            summary: "SUMMARY",
            context: {
                instructions: "Rig system instructions.",
                messages: [
                    { role: "system", content: "Project instructions." },
                    { role: "user", content: "SUMMARY" },
                ],
            },
        });
        expect(customCompacted).toMatchObject({
            status: "completed",
            summary: "CUSTOM SUMMARY",
        });
        expect(compactionPrompts).toEqual(["/compact", "/compact Keep CUSTOM_MARKER."]);
        expect(calls).toHaveLength(4);
        expect(calls.map((call) => call.options?.model)).toEqual([
            "opus[1m]",
            "sonnet[1m]",
            "sonnet[1m]",
            "sonnet[1m]",
        ]);

        const options = calls[0]?.options;
        expect(options).toMatchObject({
            allowedTools: ["mcp__rig__Read"],
            extraArgs: { "disable-slash-commands": null },
            includePartialMessages: true,
            permissionMode: "dontAsk",
            persistSession: false,
            sessionId: expect.any(String),
            settingSources: [],
            skills: [],
            strictMcpConfig: true,
            tools: [],
        });
        expect(options?.systemPrompt).toContain("Rig system instructions.");
        expect(options?.systemPrompt).toContain("Project instructions.");
        expect(options?.systemPrompt).toContain("Golden skill description.");
        expect(options?.env).toMatchObject({
            ...CLAUDE_SDK_PRIVACY_ENVIRONMENT,
            ANTHROPIC_AUTH_TOKEN: "test-token",
            CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: "1",
            CLAUDE_AGENT_SDK_MCP_NO_PREFIX: "1",
            CLAUDE_CODE_DISABLE_ATTACHMENTS: "1",
            CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
            CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
            CLAUDE_CODE_MAX_RETRIES: "10",
            DISABLE_AUTO_COMPACT: "1",
        });
        expect(options?.env).not.toHaveProperty("ANTHROPIC_API_KEY");
        expect(options?.env).not.toHaveProperty("CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR");
        expect(options?.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
        expect(options?.env).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
        expect(options?.env).not.toHaveProperty("CLAUDE_CODE_USE_FOUNDRY");
        expect(options?.env).not.toHaveProperty("CLAUDE_CODE_USE_VERTEX");
        expect(options?.settings).toEqual({ env: CLAUDE_SDK_PRIVACY_ENVIRONMENT });
        expect(addAbortListener).toHaveBeenCalledOnce();
        expect(removeAbortListener).toHaveBeenCalledOnce();
        expect(options?.mcpServers).toHaveProperty("rig");
        expect(calls[1]?.options).toMatchObject({
            persistSession: true,
            resume: expect.any(String),
        });

        const compactionOptions = calls[2]?.options;
        expect(compactionOptions).toMatchObject({
            allowedTools: ["mcp__rig__Read"],
            extraArgs: {},
            tools: [],
        });
    });
});

function fakeNativeCompactQuery(
    parameters: Parameters<ClaudeSdkQuery>[0],
    summary: string,
    prompts: string[],
): ReturnType<ClaudeSdkQuery> {
    async function* messages() {
        if (typeof parameters.prompt === "string") {
            prompts.push(parameters.prompt);
        } else {
            for await (const prompt of parameters.prompt) {
                const content = prompt.message.content;
                prompts.push(
                    typeof content === "string"
                        ? content
                        : content
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join(""),
                );
            }
        }
        await parameters.options?.sessionStore?.append(
            { projectKey: "test", sessionId: parameters.options.resume ?? "session-id" },
            [
                {
                    type: "user",
                    isCompactSummary: true,
                    message: { role: "user", content: summary },
                },
            ],
        );
        yield {
            type: "system",
            subtype: "compact_boundary",
            compact_metadata: { trigger: "manual", pre_tokens: 100, post_tokens: 10 },
            uuid: "compact-boundary",
            session_id: "session-id",
        };
        yield {
            type: "system",
            subtype: "status",
            status: null,
            compact_result: "success",
            uuid: "compact-status",
            session_id: "session-id",
        };
    }
    const generator = messages();
    return Object.assign(generator, { close: () => {} }) as unknown as ReturnType<ClaudeSdkQuery>;
}

function fakeQuery(text: string): ReturnType<ClaudeSdkQuery> {
    const result = {
        type: "result",
        subtype: "success",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        result: text,
        stop_reason: "end_turn",
        session_id: "session-id",
        total_cost_usd: 0,
        usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: "result-id",
    };
    async function* messages() {
        yield result;
    }
    const generator = messages();
    return Object.assign(generator, {
        close: () => {},
    }) as unknown as ReturnType<ClaudeSdkQuery>;
}
