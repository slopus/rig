import { describe, expect, it } from "vitest";

import { areProviderModelsCompatible } from "@/core/ProviderModelCompatibility.js";

describe("provider model compatibility", () => {
    it.each([
        ["codex", "openai/sol", "codex", "openai/terra", true],
        ["claude", "anthropic/opus", "bedrock", "anthropic/sonnet", true],
        ["bedrock", "anthropic/opus", "claude", "anthropic/sonnet", true],
        ["bedrock", "openai/sol", "bedrock", "openai/terra", true],
        ["codex", "openai/sol", "bedrock", "openai/terra", false],
        ["grok", "xai/build", "grok", "xai/composer", true],
        ["claude", "anthropic/opus", "claude", "openai/sol", false],
    ] as const)(
        "checks %s/%s against %s/%s",
        (leftType, leftModel, rightType, rightModel, expected) => {
            expect(
                areProviderModelsCompatible(
                    { modelId: leftModel, providerId: leftType, providerType: leftType },
                    { modelId: rightModel, providerId: rightType, providerType: rightType },
                ),
            ).toBe(expected);
        },
    );

    it("keeps named instances of the same provider type isolated", () => {
        expect(
            areProviderModelsCompatible(
                { modelId: "openai/sol", providerId: "personal", providerType: "codex" },
                { modelId: "openai/terra", providerId: "work", providerType: "codex" },
            ),
        ).toBe(false);
    });
});
