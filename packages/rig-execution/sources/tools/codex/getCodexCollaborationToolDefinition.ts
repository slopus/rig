import { Type } from "@sinclair/typebox";

import type { FunctionTool } from "@/types.js";

export type CodexCollaborationToolName =
    | "followup_task"
    | "interrupt_agent"
    | "list_agents"
    | "send_message"
    | "spawn_agent"
    | "wait_agent";

const definitions: Readonly<Record<CodexCollaborationToolName, FunctionTool>> = {
    followup_task: {
        name: "followup_task",
        description: `Allowed targets: compatible GPT agents using the current Codex provider.
Prefer this native tool for compatible GPT agents because it preserves Codex's encrypted collaboration transport. Use \`collaboration_ext.followup_task\` for non-GPT or cross-provider agents.

Send a follow-up task to an existing non-root target agent and trigger a turn if it is idle. If the target is already running, deliver the task promptly at message boundaries while sampling, or after the pending tool call completes.`,
        parameters: Type.Object(
            {
                target: Type.String({
                    description:
                        "Agent id or canonical task name to send a follow-up task to (from spawn_agent).",
                }),
                message: Type.String({
                    description: "Message text to send to the target agent.",
                    encrypted: true,
                }),
            },
            { additionalProperties: false },
        ),
    },
    interrupt_agent: {
        name: "interrupt_agent",
        description:
            "Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks.",
        parameters: Type.Object(
            {
                target: Type.String({
                    description: "Agent id or canonical task name to interrupt (from spawn_agent).",
                }),
            },
            { additionalProperties: false },
        ),
    },
    list_agents: {
        name: "list_agents",
        description:
            "List live agents in the current root thread tree. Optionally filter by task-path prefix.",
        parameters: Type.Object(
            {
                path_prefix: Type.Optional(
                    Type.String({
                        description:
                            "Task-path prefix filter without a trailing slash. Omit to list all live agents.",
                    }),
                ),
            },
            { additionalProperties: false },
        ),
    },
    send_message: {
        name: "send_message",
        description:
            "Send a message to an existing agent. The message will be delivered promptly. Does not trigger a new turn.",
        parameters: Type.Object(
            {
                target: Type.String({
                    description: "Relative or canonical task name to message (from spawn_agent).",
                }),
                message: Type.String({
                    description: "Message text to queue on the target agent.",
                    encrypted: true,
                }),
            },
            { additionalProperties: false },
        ),
    },
    spawn_agent: {
        name: "spawn_agent",
        description: `
        Allowed provider/model pairs (the current Codex provider is inherited):
- current Codex provider + \`openai/gpt-5.6-sol\`: Latest frontier agentic coding model. Reasoning efforts: low (default), medium, high, xhigh, max, ultra. Service tiers: priority.
- current Codex provider + \`openai/gpt-5.6-terra\`: Balanced agentic coding model for everyday work. Reasoning efforts: low, medium (default), high, xhigh, max, ultra. Service tiers: priority.
Prefer this native tool for GPT models because it preserves Codex's encrypted collaboration transport.
        Spawns an agent to work on the specified task. If your current task is \`/root/task1\` and you spawn_agent with task_name "task_3" the agent will have canonical task name \`/root/task1/task_3\`.
You are then able to refer to this agent as \`task_3\` or \`/root/task1/task_3\` interchangeably. However an agent \`/root/task2/task_3\` would only be able to communicate with this agent via its canonical name \`/root/task1/task_3\`.
The spawned agent will have the same tools as you and the ability to spawn its own subagents.

Only call this tool for a concrete, bounded subtask that can run independently alongside useful local work; otherwise continue locally.
It will be able to send you and other running agents messages, and its final answer will be provided to you when it finishes.
The new agent's canonical task name will be provided to it along with the message.

Note that passing \`fork_turns="none"\` will not pass any surrounding context to the spawned subagent, which may cause the agent to lack the context it needs to complete its task, whereas \`fork_turns="all"\` will provide the subagent with all surrounding context.`,
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
                fork_turns: Type.Optional(
                    Type.String({
                        description:
                            "Optional number of turns to fork. Defaults to `all`. Use `none`, `all`, or a positive integer string such as `3` to fork only the most recent turns.",
                    }),
                ),
            },
            { additionalProperties: false },
        ),
    },
    wait_agent: {
        name: "wait_agent",
        description:
            "Wait for a mailbox update from any live agent, including queued messages and final-status notifications. The wait also ends early when new user input is steered into the active turn. Does not return the content; returns either a summary of which agents have updates (if any), an interruption summary for steered input, or a timeout summary if no activity arrives before the deadline.",
        parameters: Type.Object(
            {
                timeout_ms: Type.Optional(
                    Type.Number({
                        description:
                            "Timeout in milliseconds. Defaults to 30000, min 10000, max 3600000.",
                    }),
                ),
            },
            { additionalProperties: false },
        ),
    },
};

export function getCodexCollaborationToolDefinition(name: string): FunctionTool | undefined {
    const definition = definitions[name as CodexCollaborationToolName];
    if (definition === undefined) return undefined;
    return {
        ...definition,
        parameters: structuredClone(definition.parameters),
    };
}
