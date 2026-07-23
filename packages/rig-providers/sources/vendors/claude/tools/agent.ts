import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_agent_tool: SessionTool = {
    name: "Agent",
    type: "local",
    description:
        "Start a subagent for a focused, self-contained task. Run it in the foreground when its result is needed immediately, or in the background to keep working while it runs.",
    parameters: Type.Object({
        context: Type.Optional(
            Type.Union([Type.Literal("parent"), Type.Literal("task")], {
                description:
                    "Rig extension: use parent to continue with the parent thread context, or task to start with only the delegated prompt. Defaults to task.",
            }),
        ),
        description: Type.String({
            description: "A short, human-readable description of the delegated task.",
        }),
        prompt: Type.String({ description: "Complete instructions for the subagent." }),
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
                    "Set to true to run the subagent in the background. A completion notification will arrive later.",
            }),
        ),
    }),
};

export const claude_agent_tool_sonnet: SessionTool = {
    name: "Agent",
    type: "local",
    description:
        "Start a subagent for a focused, self-contained task. Run it in the foreground when its result is needed immediately, or in the background to keep working while it runs.",
    parameters: Type.Object({
        context: Type.Optional(
            Type.Union([Type.Literal("parent"), Type.Literal("task")], {
                description:
                    "Rig extension: use parent to continue with the parent thread context, or task to start with only the delegated prompt. Defaults to task.",
            }),
        ),
        description: Type.String({
            description: "A short, human-readable description of the delegated task.",
        }),
        prompt: Type.String({ description: "Complete instructions for the subagent." }),
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
                    "Set to true to run the subagent in the background. A completion notification will arrive later.",
            }),
        ),
    }),
};
