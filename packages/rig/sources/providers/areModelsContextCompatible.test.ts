import { describe, expect, it } from "vitest";

import { areModelsContextCompatible } from "./areModelsContextCompatible.js";
import {
    defineModel,
    type ProviderContextCompatibility,
    type ProviderContextCompatibilityKind,
} from "./types.js";

describe("model context compatibility", () => {
    it("requires an explicit compatible provider route and model group", () => {
        const codex = model("openai/gpt", "codex");
        const codexOther = model("openai/gpt-other", "codex");
        const claude = model("anthropic/claude", "claude");
        const claudeOther = model("anthropic/claude-other", "claude");
        const grokBuild = model("xai/grok-build", "grok");
        const grokComposer = model("xai/grok-composer", "grok");
        const glm = model("zai/glm");

        expect(compatible(codex, "codex", "model_group", codex, "codex", "model_group")).toBe(true);
        expect(
            compatible(
                claude,
                "bedrock",
                "model_group",
                claudeOther,
                "bedrock",
                "model_group",
                "bedrock",
                "bedrock",
                "us-east-1",
                "us-east-1",
            ),
        ).toBe(true);
        expect(
            compatible(
                claude,
                "bedrock",
                "model_group",
                claudeOther,
                "claude",
                "model_group",
                "bedrock",
                "claude_code",
                "eu-west-1",
                undefined,
            ),
        ).toBe(true);
        expect(
            compatible(
                codex,
                "bedrock",
                "model_group",
                codexOther,
                "bedrock",
                "model_group",
                "bedrock",
                "bedrock",
                "us-east-1",
                "us-east-1",
            ),
        ).toBe(true);
        expect(
            compatible(
                codex,
                "bedrock",
                "model_group",
                codexOther,
                "bedrock",
                "model_group",
                "bedrock",
                "bedrock",
                "us-east-1",
                "eu-west-1",
            ),
        ).toBe(false);
        expect(
            compatible(
                claude,
                "claude",
                "model_group",
                claudeOther,
                "bedrock",
                "model_group",
                "claude_code",
                "bedrock",
                undefined,
                "eu-west-1",
            ),
        ).toBe(true);
        expect(compatible(codex, "codex", "model_group", codex, "bedrock", "model_group")).toBe(
            false,
        );
        expect(
            compatible(
                claude,
                "bedrock-us",
                "model_group",
                claude,
                "bedrock-eu",
                "model_group",
                "bedrock",
                "bedrock",
            ),
        ).toBe(false);
        expect(
            compatible(
                claude,
                "claude-personal",
                "model_group",
                claudeOther,
                "claude-work",
                "model_group",
                "claude_code",
                "claude_code",
            ),
        ).toBe(false);
        expect(
            compatible(grokBuild, "grok", "model_group", grokComposer, "grok", "model_group"),
        ).toBe(true);
        expect(compatible(glm, "bedrock", "model_group", glm, "bedrock", "model_group")).toBe(
            false,
        );
    });
});

function compatible(
    leftModel: ReturnType<typeof model>,
    leftProviderId: string,
    leftPolicy: ProviderContextCompatibility,
    rightModel: ReturnType<typeof model>,
    rightProviderId: string,
    rightPolicy: ProviderContextCompatibility,
    leftKind?: ProviderContextCompatibilityKind,
    rightKind?: ProviderContextCompatibilityKind,
    leftKey?: string,
    rightKey?: string,
): boolean {
    return areModelsContextCompatible(
        {
            model: leftModel,
            providerContextCompatibility: leftPolicy,
            ...(leftKind === undefined ? {} : { providerContextCompatibilityKind: leftKind }),
            ...(leftKey === undefined ? {} : { providerContextCompatibilityKey: leftKey }),
            providerId: leftProviderId,
        },
        {
            model: rightModel,
            providerContextCompatibility: rightPolicy,
            ...(rightKind === undefined ? {} : { providerContextCompatibilityKind: rightKind }),
            ...(rightKey === undefined ? {} : { providerContextCompatibilityKey: rightKey }),
            providerId: rightProviderId,
        },
    );
}

function model(id: string, contextCompatibilityGroup?: "claude" | "codex" | "grok") {
    return defineModel({
        ...(contextCompatibilityGroup === undefined ? {} : { contextCompatibilityGroup }),
        defaultThinkingLevel: "off",
        id,
        name: id,
        thinkingLevels: ["off"],
    });
}
