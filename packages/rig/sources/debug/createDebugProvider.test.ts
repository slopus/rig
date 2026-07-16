import { describe, expect, it, vi } from "vitest";

import { createInferenceStream } from "../providers/createInferenceStream.js";
import { defineModel, defineProvider, type AssistantMessage } from "../providers/types.js";
import type { DebugLog } from "./DebugLog.js";
import { createDebugProvider } from "./createDebugProvider.js";

describe("createDebugProvider", () => {
    it("keeps inference running when debug records cannot be written", async () => {
        const message: AssistantMessage = {
            api: "test",
            content: [{ text: "done", type: "text" }],
            model: "test-model",
            provider: "test-provider",
            role: "assistant",
            stopReason: "stop",
            timestamp: 1,
            usage: {
                cacheRead: 0,
                cacheWrite: 0,
                cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
                input: 0,
                output: 0,
                totalTokens: 0,
            },
        };
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test-model",
            name: "Test model",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test-provider",
            models: [model],
            stream() {
                return createInferenceStream(async function* () {
                    yield { message, reason: "stop", type: "done" };
                    return message;
                });
            },
        });
        const record = vi.fn(async () => {
            throw new Error("debug storage unavailable");
        });
        const debugProvider = createDebugProvider(provider, {
            log: { record } as unknown as DebugLog,
            runId: "run-1",
            source: "agent",
        });

        const stream = debugProvider.stream(model, { messages: [] });
        const events = [];
        for await (const event of stream) events.push(event);

        await expect(stream.result()).resolves.toBe(message);
        expect(events).toEqual([{ message, reason: "stop", type: "done" }]);
        expect(record).toHaveBeenCalledTimes(3);
    });
});
