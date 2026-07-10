import type { AgentContext, SubagentContext } from "../../agent/index.js";

export function requireSubagentContext(context: AgentContext): SubagentContext {
    if (context.subagents === undefined) {
        throw new Error("Subagent management is unavailable in this session.");
    }
    return context.subagents;
}
