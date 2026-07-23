import { describe, expect, it } from "vitest";

import { resolveBedrockModelId } from "@/vendors/bedrock/impl/resolveBedrockModelId.js";
import { resolveClaudeModelId } from "@/vendors/claude/impl/resolveClaudeModelId.js";
import { resolveCodexModelId } from "@/vendors/codex/impl/resolveCodexModelId.js";
import { resolveGrokModelId } from "@/vendors/grok/impl/resolveGrokModelId.js";

describe("Rig model IDs", () => {
    it.each([
        [resolveClaudeModelId, "anthropic/sonnet-5", "sonnet[1m]"],
        [resolveClaudeModelId, "anthropic/fable-5", "claude-fable-5[1m]"],
        [resolveClaudeModelId, "anthropic/opus-4-8", "opus[1m]"],
        [resolveCodexModelId, "openai/gpt-5.6-sol", "gpt-5.6-sol"],
        [resolveGrokModelId, "xai/grok-4.5", "grok-4.5"],
        [resolveBedrockModelId, "anthropic/sonnet-5", "anthropic.claude-sonnet-5"],
        [resolveBedrockModelId, "openai/gpt-5.6-sol", "openai.gpt-5.6-sol"],
    ])("resolves %s", (resolve, modelId, expected) => {
        expect(resolve(modelId)).toBe(expected);
    });

    it("leaves native model IDs unchanged", () => {
        expect(resolveCodexModelId("custom-model")).toBe("custom-model");
    });
});
