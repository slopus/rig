import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { codexRequestUserInputTool } from "./request_user_input.js";

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

        const result = await codexRequestUserInputTool.execute({ questions }, harness.context, {
            toolCallId: "call-1",
        });

        expect(request).toHaveBeenCalledWith(
            {
                questions: [{ ...questions[0], multiSelect: false }],
                requestId: "call-1",
            },
            undefined,
        );
        expect(result).toEqual({ answers: { database: { answers: ["PostgreSQL"] } } });
        expect(codexRequestUserInputTool.toLLM(result)).toEqual([
            {
                type: "text",
                text: '{"answers":{"database":{"answers":["PostgreSQL"]}}}',
            },
        ]);
    });
});
