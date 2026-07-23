import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_ask_user_question_tool: SessionTool = {
    name: "AskUserQuestion",
    type: "local",
    description:
        "Asks the user multiple-choice questions to clarify ambiguity, understand preferences, or make decisions.",
    parameters: Type.Object(
        {
            questions: Type.Array(
                Type.Object(
                    {
                        question: Type.String({
                            description: "The complete question to ask the user.",
                        }),
                        header: Type.String({
                            maxLength: 12,
                            description:
                                "A very short label for the question, at most 12 characters.",
                        }),
                        options: Type.Array(
                            Type.Object(
                                {
                                    label: Type.String({
                                        description: "Concise display text for this choice.",
                                    }),
                                    description: Type.String({
                                        description: "Context about the choice and its tradeoffs.",
                                    }),
                                },
                                { additionalProperties: false },
                            ),
                            { minItems: 2, maxItems: 4 },
                        ),
                        multiSelect: Type.Optional(
                            Type.Boolean({
                                description: "Allow the user to select multiple choices.",
                            }),
                        ),
                    },
                    { additionalProperties: false },
                ),
                { minItems: 1, maxItems: 4 },
            ),
        },
        { additionalProperties: false },
    ),
};

export const claude_ask_user_question_tool_sonnet: SessionTool = {
    name: "AskUserQuestion",
    type: "local",
    description:
        "Asks the user multiple-choice questions to clarify ambiguity, understand preferences, or make decisions.",
    parameters: Type.Object(
        {
            questions: Type.Array(
                Type.Object(
                    {
                        question: Type.String({
                            description: "The complete question to ask the user.",
                        }),
                        header: Type.String({
                            maxLength: 12,
                            description:
                                "A very short label for the question, at most 12 characters.",
                        }),
                        options: Type.Array(
                            Type.Object(
                                {
                                    label: Type.String({
                                        description: "Concise display text for this choice.",
                                    }),
                                    description: Type.String({
                                        description: "Context about the choice and its tradeoffs.",
                                    }),
                                },
                                { additionalProperties: false },
                            ),
                            { minItems: 2, maxItems: 4 },
                        ),
                        multiSelect: Type.Optional(
                            Type.Boolean({
                                description: "Allow the user to select multiple choices.",
                            }),
                        ),
                    },
                    { additionalProperties: false },
                ),
                { minItems: 1, maxItems: 4 },
            ),
        },
        { additionalProperties: false },
    ),
};
