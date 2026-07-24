import type { ManagedSubagent, SubagentContext } from "./SubagentContext.js";
import { resolveManagedSubagent } from "./resolveManagedSubagent.js";

export async function waitForManagedSubagent(
    subagents: SubagentContext,
    target: string,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<ManagedSubagent> {
    let agent = resolveManagedSubagent(subagents, target);
    if (agent === undefined) throw new Error("The background agent was not found.");
    if (agent.status !== "running") return agent;

    const deadline = Date.now() + timeoutMs;
    while (agent.status === "running" && Date.now() < deadline) {
        const result = await subagents.wait(Math.max(0, deadline - Date.now()), signal);
        agent = resolveManagedSubagent(subagents, target) ?? agent;
        if (result.timedOut) break;
    }
    return agent;
}
