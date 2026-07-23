import { describe, expect, it } from "vitest";

import { defineModel } from "@slopus/rig-execution";
import { resolveAutoCompactThreshold } from "./resolveAutoCompactThreshold.js";

describe("resolveAutoCompactThreshold", () => {
    it("separates a model's capacity from its effective compaction window", () => {
        const model = defineModel({
            id: "anthropic/opus-test",
            name: "Opus Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
            contextWindow: 1_000_000,
            autoCompactWindow: 200_000,
        });

        expect(resolveAutoCompactThreshold(model)).toBe(167_000);
    });

    it("uses the real context window when no effective override is configured", () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
            contextWindow: 272_000,
        });

        expect(resolveAutoCompactThreshold(model)).toBe(239_000);
    });
});
