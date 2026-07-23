import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const request_user_input = {
    name: "request_user_input",
    type: "local",
    description:
        "Request user input for one to three short questions and wait for the response. Set autoResolutionMs, from 60000 to 240000 milliseconds, only when the question is useful but non-blocking and continuing with best judgment is acceptable if the user does not answer; omit it when explicit user input is required. This tool is only available in Plan mode.",
    parameters: Type.Object(
        {
            questions: Type.Array(
                Type.Object(
                    {
                        id: Type.String({
                            description: "Stable identifier for mapping answers (snake_case).",
                        }),
                        header: Type.String({
                            description: "Short header label shown in the UI (12 or fewer chars).",
                        }),
                        question: Type.String({
                            description: "Single-sentence prompt shown to the user.",
                        }),
                        options: Type.Array(
                            Type.Object(
                                {
                                    label: Type.String({
                                        description: "User-facing label (1-5 words).",
                                    }),
                                    description: Type.String({
                                        description:
                                            "One short sentence explaining impact/tradeoff if selected.",
                                    }),
                                },
                                { additionalProperties: false },
                            ),
                            {
                                description:
                                    'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.',
                            },
                        ),
                    },
                    { additionalProperties: false },
                ),
                { description: "Questions to show the user. Prefer 1 and do not exceed 3" },
            ),
            autoResolutionMs: Type.Optional(
                Type.Number({
                    description:
                        "Optional auto-resolution window in milliseconds, from 60000 to 240000. Include this only when the question is useful but non-blocking and continuing with best judgment is acceptable if the user does not answer; omit it when explicit user input is required before continuing. Use 60000 for lightly helpful context and up to 240000 when the answer would materially unblock better work.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
