import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";

const completedAgentResultSchema = Type.Object({
    output: Type.String(),
    path: Type.String(),
    sessionId: Type.String(),
    status: Type.Literal("completed"),
    taskName: Type.String(),
});

const backgroundAgentResultSchema = Type.Object({
    agentId: Type.String(),
    description: Type.String(),
    path: Type.String(),
    prompt: Type.String(),
    status: Type.Literal("async_launched"),
    taskName: Type.String(),
});

export const claudeAgentTool = defineTool({
    name: "Agent",
    label: "Agent",
    description:
        "Start a subagent for a focused, self-contained task. Agents run in the background by default and report back when they finish. Set run_in_background to false when the result is needed immediately.",
    arguments: Type.Object({
        context: Type.Optional(
            Type.Union([Type.Literal("parent"), Type.Literal("task")], {
                description:
                    "Rig extension: use parent to continue with the parent thread context, or task to start with only the delegated prompt. Defaults to task.",
            }),
        ),
        description: Type.String({
            description: "A short, human-readable description of the delegated task.",
        }),
        prompt: Type.String({
            description: "Complete instructions for the subagent.",
        }),
        effort: Type.Optional(
            Type.String({
                description:
                    "Child effort level. Must be one of the allowed effort levels shown in the system prompt for the selected model.",
            }),
        ),
        model: Type.Optional(
            Type.String({
                description:
                    "Child model ID. The provider is inferred from the current provider or a unique match when omitted.",
            }),
        ),
        provider: Type.Optional(
            Type.String({ description: "Child provider ID. Requires an explicit model." }),
        ),
        run_in_background: Type.Optional(
            Type.Boolean({
                description:
                    "Agents run in the background by default. Set to false to wait for the result before continuing.",
            }),
        ),
    }),
    returnType: Type.Union([completedAgentResultSchema, backgroundAgentResultSchema]),
    shouldReviewInAutoMode: () => false,
    execute: async (
        {
            context: contextMode = "task",
            description,
            effort,
            model,
            prompt,
            provider,
            run_in_background = true,
        },
        context,
        execution,
    ) => {
        if (context.subagents === undefined || !context.subagents.canSpawn) {
            throw new Error("This agent has reached the maximum subagent depth.");
        }
        if (provider !== undefined && model === undefined) {
            throw new Error("The provider argument requires an explicit model.");
        }
        const result = await context.subagents.spawn(
            {
                description,
                ...(effort === undefined ? {} : { effort }),
                ...(run_in_background === true ? { background: true } : {}),
                contextMode,
                ...(contextMode === "parent" && execution.messages !== undefined
                    ? { contextMessages: execution.messages.slice(0, -1) }
                    : {}),
                ...(model === undefined ? {} : { modelId: model }),
                prompt,
                ...(provider === undefined ? {} : { providerId: provider }),
                ...(execution.toolCallId !== undefined
                    ? { parentToolCallId: execution.toolCallId }
                    : {}),
            },
            execution.signal,
        );
        if (result.status === "running") {
            return {
                agentId: result.sessionId,
                description,
                path: result.path,
                prompt,
                status: "async_launched",
                taskName: result.taskName,
            };
        }
        if (result.status !== "completed") {
            throw new Error(result.output);
        }
        return {
            output: result.output,
            path: result.path,
            sessionId: result.sessionId,
            status: "completed",
            taskName: result.taskName,
        };
    },
    toLLM: (result) => [
        {
            type: "text",
            text: result.status === "async_launched" ? JSON.stringify(result) : result.output,
        },
    ],
    toUI: (result, args) =>
        result.status === "async_launched"
            ? `Running in background: ${args.description}`
            : `Completed: ${args.description}`,
    locks: [],
});
