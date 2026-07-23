import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { codexAgentStatusSchema } from "../impl/codexAgentStatusSchema.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";
import { toCodexAgentStatus } from "../impl/toCodexAgentStatus.js";

export const codexV1WaitAgentTool = defineTool({
    name: "wait_agent",
    label: "wait_agent",
    namespace: {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
    },
    description: "Wait for any selected agent to reach a final status.",
    arguments: Type.Object(
        {
            targets: Type.Array(Type.String(), {
                description:
                    "Agent ids to wait on. Pass multiple ids to wait for whichever finishes first.",
            }),
            timeout_ms: Type.Optional(
                Type.Number({
                    description:
                        "Timeout in milliseconds. Defaults to 30000, min 10000, max 3600000.",
                    minimum: 10_000,
                    maximum: 3_600_000,
                }),
            ),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        status: Type.Record(Type.String(), codexAgentStatusSchema),
        timed_out: Type.Boolean(),
    }),
    shouldReviewInAutoMode: () => false,
    execute: async ({ targets, timeout_ms }, context, execution) => {
        const subagents = requireSubagentContext(context);
        const targetSet = new Set(targets);
        const timeout = timeout_ms ?? 30_000;
        const deadline = Date.now() + timeout;
        while (true) {
            const remaining = Math.max(0, deadline - Date.now());
            const result = await subagents.wait(remaining, execution.signal);
            const agents = result.agents.filter(
                (agent) =>
                    targetSet.has(agent.sessionId) ||
                    targetSet.has(agent.path) ||
                    targetSet.has(agent.taskName),
            );
            if (agents.length > 0) {
                return {
                    status: Object.fromEntries(
                        agents.map((agent) => [agent.sessionId, toCodexAgentStatus(agent)]),
                    ),
                    timed_out: false,
                };
            }
            if (result.timedOut || remaining === 0) {
                return { status: {}, timed_out: true };
            }
        }
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        result.timed_out
            ? "No selected subagent completed before the wait ended."
            : "Selected subagent status changed.",
    locks: [],
    steerable: true,
});
