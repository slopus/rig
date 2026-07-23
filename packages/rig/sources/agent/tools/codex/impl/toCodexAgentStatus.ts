import type { ManagedSubagent } from "../../../context/SubagentContext.js";

export type CodexAgentStatus =
    | "pending_init"
    | "running"
    | "interrupted"
    | "shutdown"
    | "not_found"
    | { completed: string | null }
    | { errored: string };

export function toCodexAgentStatus(agent: ManagedSubagent | undefined): CodexAgentStatus {
    if (agent === undefined) return "not_found";
    switch (agent.status) {
        case "running":
            return "running";
        case "suspended":
        case "aborted":
            return "interrupted";
        case "completed":
            return { completed: null };
        case "error":
            return { errored: agent.description };
    }
}
