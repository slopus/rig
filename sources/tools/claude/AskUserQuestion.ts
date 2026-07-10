import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";

const optionSchema = Type.Object(
    {
        label: Type.String({ description: "Concise display text for this choice." }),
        description: Type.String({ description: "Context about the choice and its tradeoffs." }),
    },
    { additionalProperties: false },
);

const questionSchema = Type.Object(
    {
        question: Type.String({ description: "The complete question to ask the user." }),
        header: Type.String({
            maxLength: 12,
            description: "A very short label for the question, at most 12 characters.",
        }),
        options: Type.Array(optionSchema, { minItems: 2, maxItems: 4 }),
        multiSelect: Type.Optional(
            Type.Boolean({ description: "Allow the user to select multiple choices." }),
        ),
    },
    { additionalProperties: false },
);

export const claudeAskUserQuestionTool = defineTool({
    name: "AskUserQuestion",
    label: "AskUserQuestion",
    description:
        "Asks the user multiple-choice questions to clarify ambiguity, understand preferences, or make decisions.",
    arguments: Type.Object(
        { questions: Type.Array(questionSchema, { minItems: 1, maxItems: 4 }) },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        questions: Type.Array(questionSchema),
        answers: Type.Record(Type.String(), Type.String()),
    }),
    async execute({ questions }, context, execution) {
        if (new Set(questions.map((question) => question.question)).size !== questions.length) {
            throw new Error("Interactive question text must be unique.");
        }
        if (context.userInput === undefined) {
            throw new Error("Interactive user input is unavailable in this session.");
        }
        if (execution.toolCallId === undefined) {
            throw new Error("Interactive user input requires a tool call identifier.");
        }
        const normalizedQuestions = questions.map((question, index) => ({
            ...question,
            id: `question_${index + 1}`,
            multiSelect: question.multiSelect ?? false,
        }));
        const response = await context.userInput.request(
            { requestId: execution.toolCallId, questions: normalizedQuestions },
            execution.signal === undefined ? undefined : { signal: execution.signal },
        );
        return {
            questions,
            answers: Object.fromEntries(
                normalizedQuestions.map((question) => [
                    question.question,
                    (response.answers[question.id] ?? []).join(", "),
                ]),
            ),
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (_result, args) =>
        `Answered ${args.questions.length} question${args.questions.length === 1 ? "" : "s"}`,
    locks: ["user_input"],
});
