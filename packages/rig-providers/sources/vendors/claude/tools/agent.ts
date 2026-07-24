import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_agent_tool: SessionTool = {
    name: "Agent",
    type: "local",
    description:
        "Start a subagent for a focused, self-contained task. Agents run in the background by default and report back when they finish. Set run_in_background to false when the result is needed immediately.",
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
                    "Agents run in the background by default. Set to false to wait for the result before continuing.",
            }),
        ),
    }),
};

export const claude_agent_tool_sonnet: SessionTool = {
    name: "Agent",
    type: "local",
    description:
        "Start a subagent for a focused, self-contained task. Agents run in the background by default and report back when they finish. Set run_in_background to false when the result is needed immediately.",
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
                    "Agents run in the background by default. Set to false to wait for the result before continuing.",
            }),
        ),
    }),
};
