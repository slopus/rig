import { describe, expect, it } from "vitest";

import type { Executor } from "@/Executor.js";
import { createExecutorInferenceStream } from "@/createExecutorInferenceStream.js";
import { defineModel } from "@/types.js";

describe("createExecutorInferenceStream", () => {
    it("preserves a tool-call namespace from the native provider", async () => {
        const executor = {
            run: async function* () {
                yield {
                    type: "tool_call_start",
                    callId: "spawn-call",
                    name: "spawn_agent",
                    namespace: "collaboration",
                } as const;
                yield {
                    type: "tool_call_end",
                    callId: "spawn-call",
                    arguments: '{"task_name":"inspect","message":"Inspect it."}',
                } as const;
                yield { type: "done", state: "tool_call" } as const;
            },
        } as unknown as Executor;
        const stream = createExecutorInferenceStream({
            context: { messages: [] },
            executor,
            model: defineModel({
                id: "openai/test",
                name: "Test",
                thinkingLevels: ["off"],
                defaultThinkingLevel: "off",
            }),
            providerId: "codex",
        });

        for await (const _event of stream) {
            // Consume the stream as the agent loop does.
        }

        await expect(stream.result()).resolves.toMatchObject({
            content: [
                {
                    type: "toolCall",
                    id: "spawn-call",
                    name: "spawn_agent",
                    namespace: "collaboration",
                },
            ],
            stopReason: "toolUse",
        });
    });
});
