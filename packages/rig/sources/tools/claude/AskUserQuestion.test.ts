import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeAskUserQuestionTool } from "../../agent/tools/claude/AskUserQuestion.js";

describe("Claude AskUserQuestion tool", () => {
    it("maps multi-select answers back to Claude's question-keyed result", async () => {
        const harness = createJustBashToolHarness();
        const request = vi.fn(async () => ({
            answers: { question_1: ["Email", "Push notifications"] },
        }));
        harness.context.userInput = { request };
        const questions = [
            {
                header: "Alerts",
                question: "Which alert channels should be enabled?",
                multiSelect: true,
                options: [
                    { label: "Email", description: "Send alerts by email." },
                    { label: "Push notifications", description: "Send alerts to devices." },
                ],
            },
        ];

        const result = await claudeAskUserQuestionTool.execute({ questions }, harness.context, {
            toolBatchId: "batch-2",
            toolCallId: "call-2",
            toolCallIndex: 0,
        });

        expect(request).toHaveBeenCalledWith(
            {
                questions: [{ ...questions[0], id: "question_1" }],
                requestId: "call-2",
            },
            {
                durable: {
                    batchId: "batch-2",
                    kind: "question",
                    toolArguments: { questions },
                    toolCallId: "call-2",
                    toolCallIndex: 0,
                    toolName: "AskUserQuestion",
                },
            },
        );
        expect(result).toEqual({
            answers: {
                "Which alert channels should be enabled?": "Email, Push notifications",
            },
            questions,
        });
        expect(claudeAskUserQuestionTool.toTrustedUserEvidence?.(result, { questions })).toEqual([
            {
                type: "text",
                text: '{"answers":["Email, Push notifications"]}',
            },
        ]);
    });

    it("rejects duplicate question text before answers can overwrite each other", async () => {
        const harness = createJustBashToolHarness();
        harness.context.userInput = {
            request: vi.fn(async () => ({ answers: {} })),
        };
        const question = {
            header: "Choice",
            question: "Which option should be used?",
            options: [
                { label: "One", description: "Use the first option." },
                { label: "Two", description: "Use the second option." },
            ],
        };

        await expect(
            claudeAskUserQuestionTool.execute(
                { questions: [question, { ...question, header: "Fallback" }] },
                harness.context,
                { toolCallId: "call-3" },
            ),
        ).rejects.toThrow("question text must be unique");
    });
});
