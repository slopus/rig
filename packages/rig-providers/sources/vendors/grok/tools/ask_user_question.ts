import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const ask_user_question = {
    name: "ask_user_question",
    type: "local",
    description:
        'Ask the user one or more multiple-choice questions.\n\n- Every question automatically gets an "Other" choice where the user can type their own answer.\n- Put your recommended option first and append "(Recommended)" to its label.',
    parameters: Type.Object(
        {
            questions: Type.Array(
                Type.Object(
                    {
                        question: Type.String({
                            description: "The question to ask, phrased as a full question.",
                        }),
                        options: Type.Array(
                            Type.Object(
                                {
                                    label: Type.String({
                                        description:
                                            "Option text shown to the user. A few words at most.",
                                    }),
                                    description: Type.String({
                                        description: "What picking this option means or implies.",
                                    }),
                                    preview: Type.Optional(
                                        Type.Unsafe({
                                            description:
                                                "Optional content shown while the option is focused — mockups, code snippets, anything the user should compare. Single-select questions only.",
                                            type: ["string", "null"],
                                        }),
                                    ),
                                },
                                {
                                    description: "A single option within a question.",
                                },
                            ),
                            {
                                description: "The choices for this question.",
                            },
                        ),
                        multi_select: Type.Optional(
                            Type.Unsafe({
                                description:
                                    "Let the user pick more than one option (default false).",
                                type: ["boolean", "null"],
                                default: null,
                            }),
                        ),
                    },
                    {
                        description: "A single question with its options.",
                    },
                ),
                {
                    description: "The questions to ask, each with its own options.",
                },
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "AskUserQuestionInput",
            description: "Input for the `AskUserQuestion` tool.",
        },
    ),
} as const satisfies SessionTool;
