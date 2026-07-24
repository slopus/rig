import type { AnyDefinedTool } from "../agent/types.js";
import type { Model, Provider } from "@slopus/rig-execution";
import { claudeTools } from "../agent/tools/claude/assembleClaudeTools.js";
import { assembleCodexTools } from "../agent/tools/codex/assembleCodexTools.js";
import { codexCollaborationTools } from "../agent/tools/codex/assembleCodexTools.js";
import { grokBuildTools } from "../tools/grok/index.js";
import { createGeminiTools } from "../tools/gemini/createGeminiTools.js";

export interface SelectToolsForModelOptions {
    geminiApiKey?: string;
    provider: Provider;
    model: Model;
}

export function selectToolsForModel(
    options: SelectToolsForModelOptions,
): readonly AnyDefinedTool[] {
    const toolType =
        options.provider.type === "bedrock"
            ? options.model.id.startsWith("anthropic/")
                ? "claude"
                : "codex"
            : options.provider.type;
    const collaborationNames = new Set(codexCollaborationTools.map((tool) => tool.name));
    const baseTools =
        toolType === "claude"
            ? claudeTools
            : toolType === "grok"
              ? grokBuildTools
              : assembleCodexTools(
                    options.model.id,
                    options.provider.type ?? options.provider.id,
                ).filter((tool) => !collaborationNames.has(tool.name));
    const providerTools =
        options.provider.type === "bedrock"
            ? baseTools.filter((tool) => tool.name !== "WebSearch")
            : baseTools;
    if (options.geminiApiKey === undefined) return providerTools;

    return [...providerTools, ...createGeminiTools(options.geminiApiKey)];
}
