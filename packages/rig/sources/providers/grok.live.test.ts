import { resolve } from "node:path";

import { Type } from "@sinclair/typebox";
import { beforeAll, describe, expect, it } from "vitest";

import { createNodeAgentContext, runAgentLoop } from "../agent/index.js";
import { defineTool } from "../agent/types.js";
import { NativeProxessManager } from "../processes/index.js";
import { discoverGrokModels } from "./discoverGrokModels.js";
import { createGrokProvider } from "./grok.js";
import { modelXaiGrokBuild } from "./models.js";
import { resolveGrokCredential } from "./resolveGrokCredential.js";
import type { AssistantMessage, Model, StreamOptions, TextContent } from "./types.js";

const LIVE = process.env.RIG_LIVE_TEST === "1";
const describeLive = LIVE ? describe : describe.skip;
let liveModels: readonly Model[] = [modelXaiGrokBuild];

describeLive("Grok Build provider live", () => {
    beforeAll(async () => {
        liveModels = await discoverGrokModels();
    });

    it("discovers every model advertised to the authenticated Grok account", () => {
        expect(liveModels.map((model) => model.id)).toEqual(
            expect.arrayContaining([
                "xai/grok-build",
                "xai/grok-4.5",
                "xai/grok-composer-2.5-fast",
            ]),
        );
        expect(requireLiveModel("xai/grok-4.5")).toMatchObject({
            defaultThinkingLevel: "high",
            thinkingLevels: ["low", "medium", "high"],
        });
        expect(requireLiveModel("xai/grok-composer-2.5-fast")).toMatchObject({
            defaultThinkingLevel: "off",
            thinkingLevels: ["off"],
        });
    });

    it("streams inference using the local Grok authentication store", async () => {
        await expect(resolveGrokCredential()).resolves.toMatchObject({
            token: expect.any(String),
        });

        const stream = createGrokProvider({
            models: liveModels,
            sessionId: `grok-live-${Date.now()}`,
        }).stream(modelXaiGrokBuild, {
            messages: [
                {
                    role: "user",
                    content: "Reply with exactly: grok live ok",
                    timestamp: Date.now(),
                },
            ],
        });
        let sawStart = false;
        let sawText = false;

        for await (const event of stream) {
            if (event.type === "start") sawStart = true;
            if (event.type === "text_delta" && event.delta.length > 0) sawText = true;
            if (event.type === "error") {
                throw new Error(event.error.errorMessage ?? "Grok Build stream failed");
            }
        }

        const message = await stream.result();
        expect(sawStart).toBe(true);
        expect(sawText).toBe(true);
        expect(message.stopReason).not.toBe("error");
        expect(textFromAssistantMessage(message).toLowerCase()).toContain("grok live ok");
    }, 120_000);

    it("streams Grok 4.5 with a selected reasoning effort", async () => {
        const model = requireLiveModel("xai/grok-4.5");
        const message = await runLivePrompt(model, "Reply with exactly: grok 4.5 low effort ok", {
            thinking: "low",
        });

        expect(message.stopReason).not.toBe("error");
        expect(textFromAssistantMessage(message).toLowerCase()).toContain("grok 4.5 low effort ok");
    }, 120_000);

    it("streams Composer 2.5 without a reasoning-effort override", async () => {
        const model = requireLiveModel("xai/grok-composer-2.5-fast");
        const message = await runLivePrompt(model, "Reply with exactly: composer live ok");

        expect(message.stopReason).not.toBe("error");
        expect(textFromAssistantMessage(message).toLowerCase()).toContain("composer live ok");
    }, 120_000);

    it("calls a native function tool and continues with its result", async () => {
        let executionCount = 0;
        const liveProbeTool = defineTool({
            name: "live_probe",
            label: "Live probe",
            description: "Return a deterministic value for the Grok Build live test.",
            arguments: Type.Object({
                value: Type.String({ description: "The value to acknowledge." }),
            }),
            returnType: Type.Object({ acknowledgement: Type.String() }),
            execute: ({ value }) => {
                executionCount += 1;
                return { acknowledgement: `Acknowledged: ${value}` };
            },
            toLLM: ({ acknowledgement }) => [{ type: "text", text: acknowledgement }],
            toUI: ({ acknowledgement }) => acknowledgement,
            locks: [],
        });
        const context = createNodeAgentContext({
            cwd: resolve(process.cwd(), "../.."),
            processManager: new NativeProxessManager(),
        });
        const result = await runAgentLoop({
            provider: createGrokProvider({
                models: liveModels,
                sessionId: `grok-tool-live-${Date.now()}`,
            }),
            modelId: modelXaiGrokBuild.id,
            effort: "on",
            tools: [liveProbeTool],
            instructions:
                'Call live_probe exactly once with the value "tool path ok". After receiving its result, reply with exactly: grok tool ok',
            messages: [
                {
                    role: "user",
                    id: "grok-live-tool-user",
                    blocks: [
                        {
                            type: "text",
                            text: 'Use live_probe with "tool path ok", then reply with exactly: grok tool ok',
                        },
                    ],
                },
            ],
            sessionId: `grok-tool-live-${Date.now()}`,
            context,
        });

        expect(result.stopReason).toBe("stop");
        expect(executionCount).toBe(1);
        expect(result.messages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    role: "agent",
                    blocks: expect.arrayContaining([
                        expect.objectContaining({ type: "tool_call", name: "live_probe" }),
                    ]),
                }),
                expect.objectContaining({
                    role: "agent",
                    blocks: expect.arrayContaining([
                        expect.objectContaining({ type: "tool_result", toolName: "live_probe" }),
                    ]),
                }),
            ]),
        );
        const finalText = result.messages
            .filter((message) => message.role === "agent")
            .flatMap((message) => message.blocks)
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
        expect(finalText.toLowerCase()).toContain("grok tool ok");
    }, 180_000);
});

describe("Grok Build provider live prerequisites", () => {
    it("has usable local authentication when live tests are enabled", async () => {
        if (LIVE) {
            await expect(resolveGrokCredential()).resolves.toMatchObject({
                token: expect.any(String),
            });
        }
        expect(true).toBe(true);
    });
});

function textFromAssistantMessage(message: AssistantMessage): string {
    return message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("");
}

function requireLiveModel(modelId: string): Model {
    const model = liveModels.find((candidate) => candidate.id === modelId);
    if (model === undefined) throw new Error(`Grok did not advertise ${modelId}.`);
    return model;
}

async function runLivePrompt(
    model: Model,
    prompt: string,
    streamOptions?: StreamOptions,
): Promise<AssistantMessage> {
    const stream = createGrokProvider({
        models: liveModels,
        sessionId: `grok-model-live-${Date.now()}`,
    }).stream(
        model,
        { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
        streamOptions,
    );
    for await (const event of stream) {
        if (event.type === "error") {
            throw new Error(event.error.errorMessage ?? `${model.name} stream failed`);
        }
    }
    return stream.result();
}
