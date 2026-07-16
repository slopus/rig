import { humanizeToolName } from "./humanizeToolName.js";
import type { ToolResultBlock } from "../agent/types.js";

export function formatToolResultForDisplay(
    block: Pick<ToolResultBlock, "display" | "failure" | "toolName">,
): string {
    if (block.failure?.kind === "tool_unavailable") {
        return `The model requested "${humanizeToolName(block.toolName)}", but that tool is not available in this session.`;
    }

    if (block.failure?.kind === "invalid_arguments") {
        return `The model supplied invalid information for ${humanizeToolName(block.toolName)}.`;
    }

    return block.failure?.kind === "execution_failed" && block.failure.message !== undefined
        ? block.failure.message
        : block.display;
}
