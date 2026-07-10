import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { managedSubagentSchema } from "./subagentSchemas.js";
import { requireSubagentContext } from "./requireSubagentContext.js";

export const codexWaitAgentTool = defineTool({
    name: "wait_agent",
    label: "wait_agent",
    description:
        "Wait for a subagent status change or completion. Returns early when an agent updates or the wait is cancelled.",
    arguments: Type.Object({
        timeout_ms: Type.Optional(
            Type.Number({
                description: "Maximum wait in milliseconds, from 0 to 60000.",
                maximum: 60_000,
                minimum: 0,
            }),
        ),
    }),
    returnType: Type.Object({
        agents: Type.Array(managedSubagentSchema),
        timed_out: Type.Boolean(),
    }),
    execute: async ({ timeout_ms }, context, execution) => {
        const result = await requireSubagentContext(context).wait(timeout_ms, execution.signal);
        return {
            agents: Array.from(result.agents, (agent) => ({ ...agent })),
            timed_out: result.timedOut,
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        result.timed_out
            ? "No subagent updates arrived before the wait ended."
            : `${result.agents.length} subagent update${result.agents.length === 1 ? "" : "s"}.`,
    locks: [],
});
