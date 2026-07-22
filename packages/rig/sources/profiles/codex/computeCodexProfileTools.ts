import { CodeModeAgentToolAdapter } from "../../code-mode/CodeModeAgentToolAdapter.js";
import { createCodexCollaborationNamespaceTool } from "../../code-mode/createCodexCollaborationNamespaceTool.js";
import { createRigNamespaceTool } from "../../code-mode/createRigNamespaceTool.js";
import { isCodexCollaborationNamespaceTool } from "../../code-mode/isCodexCollaborationNamespaceTool.js";
import { toProviderTool } from "../../agent/loop.js";
import { toOpenAIResponseTools } from "../../providers/toOpenAIResponseTools.js";
import { resolveModelProfile } from "../impl/resolveModelProfile.js";
import type { CodexProfileArtifactDescriptor } from "./types.js";

export function computeCodexProfileTools(target: CodexProfileArtifactDescriptor): unknown {
    const profile = resolveModelProfile("codex", `openai/${target.slug}`);
    if (profile === undefined) throw new Error(`Missing Rig profile for '${target.slug}'.`);
    const profileTools = [...profile.tools.base, ...profile.tools.collaboration];
    const collaborationNames = new Set(profile.tools.collaboration.map((tool) => tool.name));
    const tools =
        target.multiAgentVersion === "v2"
            ? [
                  ...profile.tools.base,
                  ...profile.tools.collaboration
                      .filter((tool) => isCodexCollaborationNamespaceTool(tool.name))
                      .toSorted((left, right) => left.name.localeCompare(right.name))
                      .map(createCodexCollaborationNamespaceTool),
                  ...profile.tools.collaboration.map(createRigNamespaceTool),
              ]
            : profileTools.map((tool) =>
                  collaborationNames.has(tool.name)
                      ? { ...tool, codeMode: { ...tool.codeMode, exposure: "direct" as const } }
                      : tool,
              );
    const adapter = new CodeModeAgentToolAdapter({ sessionId: `profile-${target.slug}` });
    return toOpenAIResponseTools(adapter.adapt(tools).exposedTools.map(toProviderTool));
}
