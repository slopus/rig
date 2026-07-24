import type { Model, Provider } from "@slopus/rig-execution";
import { describe, expect, it } from "vitest";

import { selectClaudeWebToolModel } from "./selectClaudeWebToolModel.js";

const current: Model = {
    id: "anthropic/fable-5",
    name: "Fable 5",
    thinkingLevels: ["off"],
    defaultThinkingLevel: "off",
};

describe("selectClaudeWebToolModel", () => {
    it("prefers an allowed Sonnet model, then an allowed Opus model", () => {
        expect(
            selectClaudeWebToolModel(
                provider([
                    current,
                    model("anthropic/opus-4-8", "Opus 4.8"),
                    model("anthropic/sonnet-5", "Sonnet 5"),
                ]),
                current,
            ).id,
        ).toBe("anthropic/sonnet-5");

        expect(
            selectClaudeWebToolModel(
                provider([current, model("anthropic/opus-4-8", "Opus 4.8")]),
                current,
            ).id,
        ).toBe("anthropic/opus-4-8");
    });

    it("uses the current session model when neither Sonnet nor Opus is allowed", () => {
        expect(selectClaudeWebToolModel(provider([current]), current)).toBe(current);
    });

    it("fails when the current model and preferred models are not allowed", () => {
        expect(() =>
            selectClaudeWebToolModel(
                provider([model("anthropic/fable-other", "Other Fable")]),
                current,
            ),
        ).toThrow("does not allow Sonnet, Opus, or the current session model");
    });
});

function model(id: string, name: string): Model {
    return { id, name, thinkingLevels: ["off"], defaultThinkingLevel: "off" };
}

function provider(models: readonly Model[]): Provider {
    return {
        id: "work-claude",
        type: "claude",
        models,
        serviceTiers: undefined,
        extendProfilePromptContext: undefined,
        quota: undefined,
        stream: () => {
            throw new Error("Not used");
        },
    };
}
