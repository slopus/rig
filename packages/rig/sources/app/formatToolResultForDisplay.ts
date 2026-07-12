import { humanizeToolName } from "./humanizeToolName.js";

export function formatToolResultForDisplay(display: string, toolName: string): string {
    if (display === `Unknown tool '${toolName}' requested by model`) {
        return `The model requested "${humanizeToolName(toolName)}", but that tool is not available in this session.`;
    }

    if (display === `Invalid arguments for tool '${toolName}'`) {
        return `The model supplied invalid information for ${humanizeToolName(toolName)}.`;
    }

    const failurePrefix = `Tool '${toolName}' failed: `;
    return display.startsWith(failurePrefix) ? display.slice(failurePrefix.length) : display;
}
