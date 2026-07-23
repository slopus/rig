import type { AnyDefinedTool } from "../agent/types.js";
import type { Model, Provider } from "@slopus/rig-execution";
import { agentTool } from "../tools/Agent.js";
import { claudeCollaborationTools } from "../tools/claude/index.js";
import { assembleCodexTools } from "../agent/tools/codex/assembleCodexTools.js";
import { codexCollaborationTools } from "../agent/tools/codex/assembleCodexTools.js";
import { grokCollaborationTools } from "../tools/grok/index.js";

const codexCollaborationToolNames = new Set(codexCollaborationTools.map((tool) => tool.name));

export function selectCollaborationToolsForModel(options: {
    model: Model;
    provider: Provider;
}): readonly AnyDefinedTool[] {
    const toolType =
        options.provider.type === "bedrock"
            ? options.model.id.startsWith("anthropic/")
                ? "claude"
                : "codex"
            : options.provider.type;
    return toolType === "claude"
        ? [agentTool, ...claudeCollaborationTools]
        : toolType === "grok"
          ? grokCollaborationTools
          : assembleCodexTools(
                options.model.id,
                options.provider.type ?? options.provider.id,
            ).filter((tool) => codexCollaborationToolNames.has(tool.name));
}
