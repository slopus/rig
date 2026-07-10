import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";

const optionSchema = Type.Object(
    {
        label: Type.String({ description: "User-facing label (1-5 words)." }),
        description: Type.String({
            description: "One short sentence explaining impact or tradeoff if selected.",
        }),
    },
    { additionalProperties: false },
);

const questionSchema = Type.Object(
    {
        id: Type.String({ description: "Stable identifier for mapping answers." }),
        header: Type.String({
            maxLength: 12,
            description: "Short header label shown in the interface, at most 12 characters.",
        }),
        question: Type.String({ description: "Single-sentence prompt shown to the user." }),
        options: Type.Array(optionSchema, {
            minItems: 2,
            maxItems: 3,
            description:
                "Provide two or three mutually exclusive choices. Do not add an Other option; the interface provides one.",
        }),
    },
    { additionalProperties: false },
);

const answerSchema = Type.Object({ answers: Type.Array(Type.String()) });

export const codexRequestUserInputTool = defineTool({
    name: "request_user_input",
    label: "request_user_input",
    description: "Request user input for one to three short questions and wait for the response.",
    arguments: Type.Object(
        {
            questions: Type.Array(questionSchema, { minItems: 1, maxItems: 3 }),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({ answers: Type.Record(Type.String(), answerSchema) }),
    async execute({ questions }, context, execution) {
        if (context.userInput === undefined) {
            throw new Error("Interactive user input is unavailable in this session.");
        }
        if (execution.toolCallId === undefined) {
            throw new Error("Interactive user input requires a tool call identifier.");
        }
        if (new Set(questions.map((question) => question.id)).size !== questions.length) {
            throw new Error("Interactive question identifiers must be unique.");
        }
        const response = await context.userInput.request(
            {
                requestId: execution.toolCallId,
                questions: questions.map((question) => ({
                    ...question,
                    multiSelect: false,
                })),
            },
            execution.signal === undefined ? undefined : { signal: execution.signal },
        );
        return {
            answers: Object.fromEntries(
                Object.entries(response.answers).map(([id, answers]) => [
                    id,
                    { answers: [...answers] },
                ]),
            ),
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (_result, args) =>
        `Answered ${args.questions.length} question${args.questions.length === 1 ? "" : "s"}`,
    locks: ["user_input"],
});
