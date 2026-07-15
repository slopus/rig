import type { SessionAgentMetadata } from "../protocol/index.js";

export function sessionAgentFooterLabel(agent: SessionAgentMetadata): string | undefined {
    if (agent.type === "primary") return undefined;
    const identity = agent.description?.trim() || humanizeTaskName(agent.taskName) || "Subagent";
    return `${identity} [subagent]`;
}

function humanizeTaskName(taskName: string | undefined): string | undefined {
    if (taskName === undefined) return undefined;
    const words = taskName.split(/[-_\s]+/u).filter((word) => word.length > 0);
    if (words.length === 0) return undefined;
    return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}
