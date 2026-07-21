import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import {
    createNodeAgentContext,
    runAgentLoop,
    type AgentContext,
    type AnyDefinedTool,
} from "../agent/index.js";
import { defineTool } from "../agent/types.js";
import { NativeProcessManager } from "../processes/index.js";
import { createClaudeSdkProvider } from "./claude-sdk.js";
import { createCodexProvider } from "./codex.js";
import { modelAnthropicSonnet46, modelOpenaiGpt54 } from "./models.js";
import { readClaudeCodeOAuthToken } from "./readClaudeCodeOAuthToken.js";
import type { Model, Provider } from "./types.js";

const LIVE = process.env.RIG_LIVE_TEST === "1";
const CODEX_AUTH_PATH = path.join(homedir(), ".codex", "auth.json");
const CACHEABLE_SYSTEM_PROMPT = [
    "This is a stable reference document used only to verify provider prompt caching.",
    ...Array.from(
        { length: 256 },
        (_, index) =>
            `Reference entry ${String(index).padStart(3, "0")}: preserve this exact sentence as immutable context for the cache validation request.`,
    ),
    "Reply to the user according to their final instruction.",
].join("\n");
const CACHEABLE_TOOL_RESULT = Array.from(
    { length: 4_096 },
    (_, index) =>
        `Stable tool result entry ${String(index).padStart(4, "0")}: this exact payload must be reused from the prompt cache.`,
).join("\n");

interface PromptCacheCase {
    createProvider: (agentContext: AgentContext, tools: readonly AnyDefinedTool[]) => Provider;
    hasAuthentication: () => boolean | Promise<boolean>;
    label: string;
    model: Model;
}

const promptCacheCases: readonly PromptCacheCase[] = [
    {
        label: "OpenAI",
        model: modelOpenaiGpt54,
        createProvider: () => createCodexProvider(),
        hasAuthentication: hasLocalCodexAuth,
    },
    {
        label: "Claude",
        model: modelAnthropicSonnet46,
        createProvider: (agentContext, tools) =>
            createClaudeSdkProvider({
                agentContext,
                tools,
            }),
        hasAuthentication: async () => (await readClaudeCodeOAuthToken()) !== undefined,
    },
];

const describeLive = LIVE ? describe : describe.skip;

describeLive("provider prompt caching", () => {
    it.each(promptCacheCases)(
        "$label reuses an identical prompt prefix",
        async ({ createProvider, hasAuthentication, label, model }) => {
            expect(
                await hasAuthentication(),
                `${label} authentication is required for the live prompt-cache test.`,
            ).toBe(true);

            const agentContext = createLiveAgentContext();
            const provider = createProvider(agentContext, []);
            const context = {
                systemPrompt: CACHEABLE_SYSTEM_PROMPT,
                messages: [
                    {
                        role: "user" as const,
                        content: "Reply with exactly: cache ok",
                        timestamp: 1,
                    },
                ],
            };
            const streamOptions = {
                sessionId: `prompt-cache-live-${label.toLowerCase()}-${Date.now()}`,
                thinking: "off",
            };

            const warmup = await provider.stream(model, context, streamOptions).result();
            expect(
                warmup.stopReason,
                `${label} warmup failed: ${warmup.errorMessage ?? "unknown provider error"}`,
            ).not.toBe("error");

            const cached = await provider.stream(model, context, streamOptions).result();
            expect(
                cached.stopReason,
                `${label} cached request failed: ${cached.errorMessage ?? "unknown provider error"}`,
            ).not.toBe("error");
            expect(
                cached.usage.cacheRead,
                `${label} did not cache the complete identical prompt. Warmup usage: ${JSON.stringify(warmup.usage)}; cached usage: ${JSON.stringify(cached.usage)}`,
            ).toBeGreaterThanOrEqual(
                label === "Claude"
                    ? warmup.usage.input + warmup.usage.cacheRead + warmup.usage.cacheWrite
                    : 1,
            );
        },
        180_000,
    );

    it.each(promptCacheCases)(
        "$label reuses cached input for a tool-result continuation",
        async ({ createProvider, hasAuthentication, label, model }) => {
            expect(
                await hasAuthentication(),
                `${label} authentication is required for the live prompt-cache test.`,
            ).toBe(true);

            const executedSteps: number[] = [];
            const cacheProbeTool = defineTool({
                name: "CacheProbe",
                label: "Cache probe",
                description: "Acknowledge a prompt-cache continuation test value.",
                arguments: Type.Object({ step: Type.Number() }),
                returnType: Type.Object({ acknowledgement: Type.String() }),
                shouldReviewInAutoMode: () => false,
                execute: ({ step }) => {
                    executedSteps.push(step);
                    return {
                        acknowledgement:
                            step === 1
                                ? `${CACHEABLE_TOOL_RESULT}\n\nThe first result is complete. Call CacheProbe with step 2 now.`
                                : `Acknowledged step ${step}.`,
                    };
                },
                toLLM: ({ acknowledgement }) => [{ type: "text", text: acknowledgement }],
                toUI: ({ acknowledgement }) => acknowledgement,
                locks: [],
            });
            const agentContext = createLiveAgentContext();
            const provider = createProvider(agentContext, [cacheProbeTool]);
            const assistantUsages: Array<{
                cacheRead: number;
                cacheWrite: number;
                input: number;
            }> = [];
            const inferenceErrors: string[] = [];
            const result = await runAgentLoop({
                provider,
                modelId: model.id,
                effort: "off",
                tools: [cacheProbeTool],
                instructions: `${CACHEABLE_SYSTEM_PROMPT}\n\nCall CacheProbe with step 1. Only after receiving that result, call CacheProbe with step 2. Only after receiving the second result, reply with exactly: continuation ok. Never call both steps in parallel.`,
                messages: [
                    {
                        role: "user",
                        id: "prompt-cache-tool-user",
                        blocks: [
                            {
                                type: "text",
                                text: "Call CacheProbe with step 1, wait for its result, then call it with step 2, wait for that result, and reply with exactly: continuation ok",
                            },
                        ],
                    },
                ],
                sessionId: `prompt-cache-tool-live-${label.toLowerCase()}-${Date.now()}`,
                context: agentContext,
                onEvent: (event) => {
                    if (event.type === "error" && event.error.errorMessage !== undefined) {
                        inferenceErrors.push(event.error.errorMessage);
                    }
                    if (event.type === "done") {
                        assistantUsages.push({
                            cacheRead: event.message.usage.cacheRead,
                            cacheWrite: event.message.usage.cacheWrite,
                            input: event.message.usage.input,
                        });
                    }
                },
            });

            expect(
                result.stopReason,
                `Unexpected agent result: ${JSON.stringify(result.messages.at(-1))}; errors: ${JSON.stringify(inferenceErrors)}`,
            ).toBe("stop");
            expect(executedSteps).toEqual([1, 2]);
            expect(result.messages).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        role: "agent",
                        blocks: expect.arrayContaining([
                            expect.objectContaining({
                                type: "tool_call",
                                name: "CacheProbe",
                            }),
                        ]),
                    }),
                    expect.objectContaining({
                        role: "agent",
                        blocks: expect.arrayContaining([
                            expect.objectContaining({
                                type: "tool_result",
                                toolName: "CacheProbe",
                            }),
                        ]),
                    }),
                ]),
            );
            expect(assistantUsages).toHaveLength(3);
            const secondUsage = assistantUsages[1];
            const thirdUsage = assistantUsages[2];
            if (secondUsage === undefined || thirdUsage === undefined) {
                throw new Error("Expected three Claude inference usage records.");
            }
            expect(
                thirdUsage.cacheRead,
                `${label} did not read the complete prior tool request and result from cache. Usage by turn: ${JSON.stringify(assistantUsages)}`,
            ).toBeGreaterThanOrEqual(
                label === "Claude"
                    ? secondUsage.input + secondUsage.cacheRead + secondUsage.cacheWrite
                    : 1,
            );
        },
        180_000,
    );
});

describe("provider prompt caching live prerequisites", () => {
    it("keeps the stable cache prefix comfortably above provider minimums", () => {
        expect(CACHEABLE_SYSTEM_PROMPT.split(/\s+/).length).toBeGreaterThan(2_048);
    });
});

function hasLocalCodexAuth(authPath: string = CODEX_AUTH_PATH): boolean {
    if (!existsSync(authPath)) {
        return false;
    }

    try {
        const data = JSON.parse(readFileSync(authPath, "utf8")) as {
            tokens?: { access_token?: unknown };
        };
        const token = data.tokens?.access_token;
        return typeof token === "string" && token.length > 0;
    } catch {
        return false;
    }
}

function createLiveAgentContext(): AgentContext {
    return createNodeAgentContext({
        cwd: process.cwd(),
        processManager: new NativeProcessManager(),
    });
}
