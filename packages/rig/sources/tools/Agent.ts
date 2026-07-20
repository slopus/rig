import { Type } from "@sinclair/typebox";

import { defineTool } from "../agent/types.js";

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

export const agentTool = defineTool({
    name: "Agent",
    label: "Agent",
    description:
        "Start a subagent for a focused, self-contained task. Run it in the foreground when its result is needed immediately, or in the background to keep working while it runs.",
    arguments: Type.Object({
        context: Type.Union([Type.Literal("parent"), Type.Literal("task")], {
            description:
                "Use parent to continue with the parent thread context, or task to start with only the delegated prompt.",
        }),
        description: Type.String({
            description: "A short, human-readable description of the delegated task.",
        }),
        prompt: Type.String({
            description: "Complete instructions for the subagent.",
        }),
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
                    "Set to true to run the subagent in the background. A completion notification will arrive later.",
            }),
        ),
    }),
    returnType: Type.Union([completedAgentResultSchema, backgroundAgentResultSchema]),
    shouldReviewInAutoMode: () => false,
    execute: async (
        { context: contextMode, description, model, prompt, provider, run_in_background },
        context,
        execution,
    ) => {
        if (context.subagents === undefined || !context.subagents.canSpawn) {
            throw new Error("This agent has reached the maximum subagent depth.");
        }
        const result = await context.subagents.spawn(
            {
                description,
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
