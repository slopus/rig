import { describe, expect, it } from "vitest";

import { createInferenceStream } from "@slopus/rig-execution";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type StreamOptions,
} from "@slopus/rig-execution";
import { generateSessionMetadata, parseSessionMetadata } from "./generateSessionMetadata.js";

describe("parseSessionMetadata", () => {
    it("accepts only the strict bounded title and recap object", () => {
        expect(
            parseSessionMetadata(
                '{"title":"Delayed session metadata","recap":"The user added delayed metadata. The implementation is complete."}',
            ),
        ).toEqual({
            recap: "The user added delayed metadata. The implementation is complete.",
            title: "Delayed session metadata",
        });

        expect(() => parseSessionMetadata("```json\n{}\n```")).toThrow("invalid JSON");
        expect(() => parseSessionMetadata('{"title":"One","recap":"Valid recap."}')).toThrow(
            "2 to 6 words",
        );
        expect(() =>
            parseSessionMetadata('{"title":"Valid title","recap":"One. Two. Three."}'),
        ).toThrow("at most 2 sentences");
        expect(() =>
            parseSessionMetadata('{"title":"Valid title","recap":"Valid recap.","extra":"no"}'),
        ).toThrow("only string title and recap");
    });

    it("forwards the stored session start date to metadata inference", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/gpt-5.4",
            name: "Metadata model",
            thinkingLevels: ["off"],
        });
        let observedOptions: StreamOptions | undefined;
        const message: AssistantMessage = {
            api: "test",
            content: [
                {
                    text: '{"title":"Stable session date","recap":"The stored session date was forwarded."}',
                    type: "text",
                },
            ],
            model: model.id,
            provider: "codex",
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
        const provider = defineProvider({
            id: "codex",
            models: [model],
            stream(_model, _context, options) {
                observedOptions = options;
                return createInferenceStream(async function* () {
                    yield { message, reason: "stop", type: "done" };
                    return message;
                });
            },
        });

        await generateSessionMetadata({
            provider,
            sessionId: "session-1",
            startDate: "2024-01-02",
            transcript: "User: Keep the date stable.",
        });

        expect(observedOptions).toMatchObject({
            sessionId: "session-1:title",
            startDate: "2024-01-02",
        });
    });
});
