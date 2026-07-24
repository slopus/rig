import type { ManagedSubagent, SubagentContext } from "./SubagentContext.js";

export function findManagedSubagent(
    subagents: SubagentContext,
    target: string,
): ManagedSubagent | undefined {
    return subagents
        .list()
        .find(
            (agent) =>
                agent.sessionId === target || agent.path === target || agent.taskName === target,
        );
}
