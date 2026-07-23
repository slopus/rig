import type { SessionTool } from "@/core/SessionTool.js";
import { claude_sonnet_tools, claude_tools } from "@/vendors/claude/tools/index.js";

export function resolveClaudeTools(model: string): readonly SessionTool[] {
    return model.toLowerCase().includes("sonnet") ? claude_sonnet_tools : claude_tools;
}
