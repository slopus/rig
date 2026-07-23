import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const spawn_agent = {
    name: "spawn_agent",
    namespace: "collaboration",
    type: "local",
    description:
        '\n        Available model overrides (optional; inherited parent model is preferred):\n- `gpt-5.6-sol`: Latest frontier agentic coding model. Reasoning efforts: low (default), medium, high, xhigh, max, ultra. Service tiers: priority.\n- `gpt-5.6-terra`: Balanced agentic coding model for everyday work. Reasoning efforts: low, medium (default), high, xhigh, max, ultra. Service tiers: priority.\n        Spawns an agent to work on the specified task. If your current task is `/root/task1` and you spawn_agent with task_name "task_3" the agent will have canonical task name `/root/task1/task_3`.\nYou are then able to refer to this agent as `task_3` or `/root/task1/task_3` interchangeably. However an agent `/root/task2/task_3` would only be able to communicate with this agent via its canonical name `/root/task1/task_3`.\nThe spawned agent will have the same tools as you and the ability to spawn its own subagents.\n\nOnly call this tool for a concrete, bounded subtask that can run independently alongside useful local work; otherwise continue locally.\nIt will be able to send you and other running agents messages, and its final answer will be provided to you when it finishes.\nThe new agent\'s canonical task name will be provided to it along with the message.\n\nNote that passing `fork_turns="none"` will not pass any surrounding context to the spawned subagent, which may cause the agent to lack the context it needs to complete its task, whereas `fork_turns="all"` will provide the subagent with all surrounding context.',
    parameters: Type.Object(
        {
            task_name: Type.String({
                description:
                    "Task name for the new agent. Use lowercase letters, digits, and underscores.",
            }),
            message: Type.String({
                description: "Initial plain-text task for the new agent.",
                encrypted: true,
            }),
            fork_turns: Type.Optional(
                Type.String({
                    description:
                        "Optional number of turns to fork. Defaults to `all`. Use `none`, `all`, or a positive integer string such as `3` to fork only the most recent turns.",
                }),
            ),
            model: Type.Optional(
                Type.String({
                    description:
                        "Model override for the new agent. Omit unless an explicit override is needed.",
                }),
            ),
            reasoning_effort: Type.Optional(
                Type.String({
                    description:
                        "Reasoning effort override for the new agent. Omit to inherit the parent effort.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
