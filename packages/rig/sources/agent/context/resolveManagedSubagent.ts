import type { ManagedSubagent, SubagentContext } from "./SubagentContext.js";
import { findManagedSubagent } from "./findManagedSubagent.js";

export function resolveManagedSubagent(
    subagents: SubagentContext | undefined,
    target: string,
): ManagedSubagent | undefined {
    if (subagents === undefined) return undefined;
    const listed = findManagedSubagent(subagents, target);
    if (listed === undefined) return undefined;
    return subagents.inspect?.(target) ?? listed;
}
