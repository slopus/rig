import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createCodingAssistantAgent } from "../runtime/createCodingAssistantAgent.js";
import { validJpeg32Base64, validPng32Base64 } from "../tools/testing/validImageFixtures.js";
import { createCodexProvider } from "./codex.js";
import { modelOpenaiGpt55, modelOpenaiGpt56Sol } from "./models.js";
import type { AssistantMessage, Context, TextContent } from "./types.js";

const LIVE = process.env.RIG_LIVE_TEST === "1";
const CODEX_AUTH_PATH = path.join(homedir(), ".codex", "auth.json");

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

function textFromAssistantMessage(message: AssistantMessage): string {
    return message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("");
}

const describeLive = LIVE && hasLocalCodexAuth() ? describe : describe.skip;

describeLive("codex provider live", () => {
    it("accepts and invokes Rig's provider-neutral agent namespace", async () => {
        let spawnRequest:
            | {
                  encryptedPrompt?: string;
                  modelId?: string;
                  prompt: string;
                  providerId?: string;
              }
            | undefined;
        const managed = {
            description: "Live Rig probe",
            path: "/root/live_rig_probe",
            sessionId: "live-rig-subagent",
            status: "completed" as const,
            taskName: "live_rig_probe",
        };
        const runtime = createCodingAssistantAgent({
            cwd: process.cwd(),
            modelId: modelOpenaiGpt56Sol.id,
            subagents: {
                canSpawn: true,
                depth: 0,
                followUp: () => managed,
                interrupt: () => managed,
                list: () => [managed],
                maxDepth: 3,
                resume: () => managed,
                spawn: async (request) => {
                    spawnRequest = request;
                    return { ...managed, output: "ok" };
                },
                wait: async () => ({ agents: [managed], timedOut: false }),
            },
        });

        try {
            runtime.agent.enqueueUserMessage(
                "Call rig.spawn_agent exactly once with context task, task_name live_rig_probe, message 'Reply exactly ok', model openai/gpt-5.6-sol, and provider codex. Do not call another tool. Then reply exactly: live rig ok",
            );
            await runtime.agent.run();

            expect(spawnRequest).toMatchObject({
                modelId: "openai/gpt-5.6-sol",
                prompt: "Reply exactly ok",
                providerId: "codex",
            });
            expect(spawnRequest?.encryptedPrompt).toBeUndefined();
        } finally {
            await runtime.agent.close();
        }
    }, 120_000);

    it("accepts and invokes Rig's exact reserved collaboration schema", async () => {
        let spawnRequest:
            | {
                  contextMode?: string;
                  encryptedPrompt?: string;
                  prompt: string;
                  taskName?: string;
              }
            | undefined;
        const managed = {
            description: "Live probe",
            path: "/root/live_probe",
            sessionId: "live-subagent",
            status: "completed" as const,
            taskName: "live_probe",
        };
        const runtime = createCodingAssistantAgent({
            cwd: process.cwd(),
            modelId: modelOpenaiGpt56Sol.id,
            subagents: {
                canSpawn: true,
                depth: 0,
                followUp: () => managed,
                interrupt: () => managed,
                list: () => [managed],
                maxDepth: 3,
                resume: () => managed,
                spawn: async (request) => {
                    spawnRequest = request;
                    return { ...managed, output: "ok" };
                },
                wait: async () => ({ agents: [managed], timedOut: false }),
            },
        });

        try {
            runtime.agent.enqueueUserMessage(
                "Call collaboration.spawn_agent exactly once with task_name live_probe, message 'Reply exactly ok', and fork_turns none. Do not call another tool. Then reply exactly: live collaboration ok",
            );
            await runtime.agent.run();

            expect(spawnRequest).toMatchObject({
                contextMode: "task",
                prompt: "",
                taskName: "live_probe",
            });
            expect(spawnRequest?.encryptedPrompt).toMatch(/^gAAAA/);
        } finally {
            await runtime.agent.close();
        }
    }, 120_000);

    it("streams inference using local ~/.codex/auth.json authentication", async () => {
        const provider = createCodexProvider();
        const stream = provider.stream(modelOpenaiGpt55, {
            messages: [
                {
                    role: "user",
                    content: "Reply with exactly: ok",
                    timestamp: Date.now(),
                },
            ],
        });

        let sawStart = false;
        let sawText = false;

        for await (const event of stream) {
            if (event.type === "start") {
                sawStart = true;
            }
            if (event.type === "text_delta" && event.delta.length > 0) {
                sawText = true;
            }
            if (event.type === "error") {
                throw new Error(event.error.errorMessage ?? "codex stream failed");
            }
        }

        const message = await stream.result();

        expect(sawStart).toBe(true);
        expect(sawText).toBe(true);
        expect(message.stopReason).not.toBe("error");
        expect(textFromAssistantMessage(message).toLowerCase()).toContain("ok");
    }, 120_000);

    it.each([
        { name: "PNG", mediaType: "image/png", base64: validPng32Base64 },
        { name: "JPEG", mediaType: "image/jpeg", base64: validJpeg32Base64 },
    ])(
        "accepts a valid generated $name in a tool result",
        async ({ mediaType, base64 }) => {
            const provider = createCodexProvider({ transport: "sse" });
            const stream = provider.stream(
                modelOpenaiGpt55,
                imageToolResultContext(mediaType, base64),
                { thinking: "off" },
            );

            for await (const event of stream) {
                if (event.type === "error") {
                    throw new Error(event.error.errorMessage ?? "codex rejected the image");
                }
            }

            const message = await stream.result();
            expect(message.stopReason).not.toBe("error");
            expect(textFromAssistantMessage(message).length).toBeGreaterThan(0);
        },
        120_000,
    );
});

function imageToolResultContext(mediaType: string, base64: string): Context {
    const timestamp = Date.now();
    return {
        messages: [
            {
                role: "user",
                content: "Use view_image, then acknowledge that its image loaded.",
                timestamp,
            },
            {
                role: "assistant",
                content: [
                    {
                        type: "toolCall",
                        id: "call_image|fc_image",
                        name: "view_image",
                        arguments: { path: "/workspace/generated-image" },
                    },
                ],
                api: "rig",
                provider: "codex",
                model: modelOpenaiGpt55.id,
                usage: {
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
                },
                stopReason: "toolUse",
                timestamp,
            },
            {
                role: "toolResult",
                toolCallId: "call_image|fc_image",
                toolName: "view_image",
                content: [
                    {
                        type: "image",
                        mimeType: mediaType,
                        data: base64,
                        detail: "original",
                    },
                ],
                isError: false,
                timestamp,
            },
        ],
    };
}

describe("codex provider live prerequisites", () => {
    it("documents how to run the live test", () => {
        if (LIVE && !hasLocalCodexAuth()) {
            expect.fail(
                "RIG_LIVE_TEST=1 is set but ~/.codex/auth.json is missing a usable access_token",
            );
        }

        expect(true).toBe(true);
    });
});
