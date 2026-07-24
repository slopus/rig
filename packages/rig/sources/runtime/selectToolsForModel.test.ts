import { describe, expect, it } from "vitest";

import { selectToolsForModel } from "./selectToolsForModel.js";
import { modelAnthropicSonnet46, modelXaiGrokBuild } from "@slopus/rig-execution";
import { defineProvider } from "@slopus/rig-execution";
import { grokBuildTools } from "../tools/grok/index.js";

describe("selectToolsForModel", () => {
    it("selects the Grok tool surface for Grok models", () => {
        const provider = defineProvider({
            id: "custom-xai-provider",
            models: [modelXaiGrokBuild],
            type: "grok",
            stream: () => {
                throw new Error("Inference is not used by this test.");
            },
        });

        expect(selectToolsForModel({ model: modelXaiGrokBuild, provider })).toBe(grokBuildTools);
    });

    it("keeps WebFetch but omits unsupported WebSearch for Bedrock Claude models", () => {
        const tools = selectToolsForModel({
            model: modelAnthropicSonnet46,
            provider: {
                id: "bedrock",
                type: "bedrock",
                models: [modelAnthropicSonnet46],
                serviceTiers: undefined,
                extendProfilePromptContext: undefined,
                quota: undefined,
                stream: () => {
                    throw new Error("Not used");
                },
            },
        });

        expect(tools.map((tool) => tool.name)).toContain("WebFetch");
        expect(tools.map((tool) => tool.name)).not.toContain("WebSearch");
    });

    it("adds every universal Gemini tool to every provider-owned tool profile", () => {
        for (const toolProfile of ["claude", "codex", "grok"] as const) {
            const provider = providerWithToolProfile(toolProfile);

            const tools = selectToolsForModel({
                geminiApiKey: "gemini-key",
                model: modelXaiGrokBuild,
                provider,
            });

            expect(tools.map((tool) => tool.name)).toEqual(
                expect.arrayContaining([
                    "gemini_search",
                    "gemini_generate_image",
                    "gemini_generate_music",
                    "gemini_analyze_media",
                ]),
            );
            if (toolProfile === "claude") {
                expect(tools.filter((tool) => tool.name === "WebSearch")).toHaveLength(1);
            }
        }
    });
});

function providerWithToolProfile(toolProfile: "claude" | "codex" | "grok") {
    return defineProvider({
        id: `${toolProfile}-compatible-provider`,
        models: [modelXaiGrokBuild],
        type: toolProfile,
        stream: () => {
            throw new Error("Inference is not used by this test.");
        },
    });
}
