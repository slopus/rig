import { Type } from "@sinclair/typebox";

import {
    DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS,
    MAX_SUBAGENT_WAIT_TIMEOUT_MS,
    MIN_SUBAGENT_WAIT_TIMEOUT_MS,
} from "../../../context/subagentWaitTimeouts.js";
import { defineTool } from "../../../types.js";
import { managedSubagentSchema } from "../impl/subagentSchemas.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";

export const codexWaitAgentTool = defineTool({
    name: "wait_agent",
    label: "wait_agent",
    namespace: {
        name: "collaboration",
        description: "Tools for spawning and managing sub-agents.",
    },
    description:
        "Wait for a subagent status change or completion. Returns early when an agent updates, new user input arrives, or the wait is cancelled.",
    arguments: Type.Object({
        timeout_ms: Type.Optional(
            Type.Number({
                description: `Maximum wait in milliseconds. Defaults to ${DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS}, min ${MIN_SUBAGENT_WAIT_TIMEOUT_MS}, max ${MAX_SUBAGENT_WAIT_TIMEOUT_MS}.`,
                maximum: MAX_SUBAGENT_WAIT_TIMEOUT_MS,
                minimum: MIN_SUBAGENT_WAIT_TIMEOUT_MS,
            }),
        ),
    }),
    returnType: Type.Object({
        agents: Type.Array(managedSubagentSchema),
        timed_out: Type.Boolean(),
    }),
    interruptionMessage: "Waiting for subagents was interrupted by new input.",
    shouldReviewInAutoMode: () => false,
    steerable: true,
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
