import type { AnyDefinedTool } from "../agent/types.js";
import type { Model, Provider } from "@slopus/rig-execution";
import { claudeCodeTools } from "../tools/claude/index.js";
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
            ? claudeCodeTools
            : toolType === "grok"
              ? grokBuildTools
              : assembleCodexTools(
                    options.model.id,
                    options.provider.type ?? options.provider.id,
                ).filter((tool) => !collaborationNames.has(tool.name));
    if (options.geminiApiKey === undefined) return baseTools;

    return [...baseTools, ...createGeminiTools(options.geminiApiKey)];
}
