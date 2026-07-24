import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import type { UserInputResponse } from "../../../user-input/index.js";

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
const MIN_AUTO_RESOLUTION_MS = 60_000;
const MAX_AUTO_RESOLUTION_MS = 240_000;

function resolveCodexUserInput(response: UserInputResponse) {
    return {
        answers: Object.fromEntries(
            Object.entries(response.answers).map(([id, answers]) => [
                id,
                { answers: [...answers] },
            ]),
        ),
    };
}

export const codexRequestUserInputTool = defineTool({
    name: "request_user_input",
    label: "request_user_input",
    description: "Request user input for one to three short questions and wait for the response.",
    executorTool: {
        name: "request_user_input",
        description:
            "Request user input for one to three short questions and wait for the response. Set autoResolutionMs, from 60000 to 240000 milliseconds, only when the question is useful but non-blocking and continuing with best judgment is acceptable if the user does not answer; omit it when explicit user input is required. This tool is only available in Plan mode.",
        parameters: Type.Object(
            {
                autoResolutionMs: Type.Optional(
                    Type.Number({
                        description:
                            "Optional auto-resolution window in milliseconds, from 60000 to 240000. Include this only when the question is useful but non-blocking and continuing with best judgment is acceptable if the user does not answer; omit it when explicit user input is required before continuing. Use 60000 for lightly helpful context and up to 240000 when the answer would materially unblock better work.",
                    }),
                ),
                questions: Type.Array(
                    Type.Object(
                        {
                            id: Type.String({
                                description: "Stable identifier for mapping answers (snake_case).",
                            }),
                            header: Type.String({
                                description:
                                    "Short header label shown in the UI (12 or fewer chars).",
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
                    {
                        description: "Questions to show the user. Prefer 1 and do not exceed 3",
                    },
                ),
            },
            { additionalProperties: false },
        ),
    },
    parseExecutorToolArguments: (argumentsValue) => {
        if (typeof argumentsValue !== "object" || argumentsValue === null) return {};
        const normalized = { ...argumentsValue };
        if ("autoResolutionMs" in normalized && typeof normalized.autoResolutionMs === "number") {
            normalized.autoResolutionMs = Math.max(
                MIN_AUTO_RESOLUTION_MS,
                Math.min(MAX_AUTO_RESOLUTION_MS, normalized.autoResolutionMs),
            );
        }
        return normalized;
    },
    arguments: Type.Object(
        {
            autoResolutionMs: Type.Optional(
                Type.Number({
                    description:
                        "Optional auto-resolution window in milliseconds. Include only for non-blocking questions.",
                    minimum: MIN_AUTO_RESOLUTION_MS,
                    maximum: MAX_AUTO_RESOLUTION_MS,
                }),
            ),
            questions: Type.Array(questionSchema, { minItems: 1, maxItems: 3 }),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({ answers: Type.Record(Type.String(), answerSchema) }),
    execution: "durable",
    shouldReviewInAutoMode: () => false,
    async execute({ autoResolutionMs, questions }, context, execution) {
        if (context.userInput === undefined) {
            throw new Error("Interactive user input is unavailable in this session.");
        }
        if (execution.toolCallId === undefined) {
            throw new Error("Interactive user input requires a tool call identifier.");
        }
        if (execution.toolBatchId === undefined || execution.toolCallIndex === undefined) {
            throw new Error("Durable interactive user input requires its tool batch identity.");
        }
        if (new Set(questions.map((question) => question.id)).size !== questions.length) {
            throw new Error("Interactive question identifiers must be unique.");
        }
        const response = await context.userInput.request(
            {
                ...(autoResolutionMs === undefined ? {} : { autoResolutionMs }),
                requestId: execution.toolCallId,
                questions: questions.map((question) => ({
                    ...question,
                    multiSelect: false,
                })),
            },
            {
                durable: {
                    batchId: execution.toolBatchId,
                    kind: "question",
                    toolArguments: {
                        ...(autoResolutionMs === undefined ? {} : { autoResolutionMs }),
                        questions,
                    },
                    toolCallId: execution.toolCallId,
                    toolCallIndex: execution.toolCallIndex,
                    toolName: "request_user_input",
                },
                ...(execution.signal === undefined ? {} : { signal: execution.signal }),
            },
        );
        return resolveCodexUserInput(response);
    },
    resolveUserInput: resolveCodexUserInput,
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toTrustedUserEvidence: (result) => [
        {
            type: "text",
            text: JSON.stringify({
                answers: Object.values(result.answers).map((answer) => answer.answers),
            }),
        },
    ],
    toUI: (_result, args) =>
        `Answered ${args.questions.length} question${args.questions.length === 1 ? "" : "s"}`,
    locks: [],
});
