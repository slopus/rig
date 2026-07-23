import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../../../tools/testing/createJustBashToolHarness.js";
import { codexRequestUserInputTool } from "../../tools/codex/request_user_input.js";

describe("Codex request_user_input tool", () => {
    it("pauses for a structured answer and returns Codex's answer shape", async () => {
        const harness = createJustBashToolHarness();
        const request = vi.fn(async () => ({ answers: { database: ["PostgreSQL"] } }));
        harness.context.userInput = { request };
        const questions = [
            {
                header: "Database",
                id: "database",
                question: "Which database should this service use?",
                options: [
                    { label: "PostgreSQL", description: "Use the existing relational stack." },
                    { label: "SQLite", description: "Keep local setup lightweight." },
                ],
            },
        ];

        const result = await codexRequestUserInputTool.execute(
            { autoResolutionMs: 60_000, questions },
            harness.context,
            {
                toolBatchId: "batch-1",
                toolCallId: "call-1",
                toolCallIndex: 0,
            },
        );

        expect(request).toHaveBeenCalledWith(
            {
                autoResolutionMs: 60_000,
                questions: [{ ...questions[0], multiSelect: false }],
                requestId: "call-1",
            },
            {
                durable: {
                    batchId: "batch-1",
                    kind: "question",
                    toolArguments: { autoResolutionMs: 60_000, questions },
                    toolCallId: "call-1",
                    toolCallIndex: 0,
                    toolName: "request_user_input",
                },
            },
        );
        expect(result).toEqual({ answers: { database: { answers: ["PostgreSQL"] } } });
        expect(codexRequestUserInputTool.toLLM(result)).toEqual([
            {
                type: "text",
                text: '{"answers":{"database":{"answers":["PostgreSQL"]}}}',
            },
        ]);
        expect(
            codexRequestUserInputTool.toTrustedUserEvidence?.(result, {
                autoResolutionMs: 60_000,
                questions,
            }),
        ).toEqual([
            {
                type: "text",
                text: '{"answers":[["PostgreSQL"]]}',
            },
        ]);
    });

    it("clamps Codex's provider-facing auto-resolution window before validation", () => {
        expect(
            codexRequestUserInputTool.parseExecutorToolArguments?.({
                autoResolutionMs: 1,
                questions: [],
            }),
        ).toEqual({ autoResolutionMs: 60_000, questions: [] });
    });
});
