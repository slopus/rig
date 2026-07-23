import { describe, expect, it } from "vitest";

import type { SessionTool } from "@/core/SessionTool.js";
import { createCodexCliSseRequest } from "@/vendors/codex/impl/createCodexCliSseRequest.js";
import { estimateCodexContextTokens } from "@/vendors/codex/impl/estimateCodexContextTokens.js";
import { fitCodexCompactionRequest } from "@/vendors/codex/impl/fitCodexCompactionRequest.js";

describe("Codex compaction request safety", () => {
    it("rewrites huge tool output before sending an over-window compaction request", () => {
        const fitted = fitCodexCompactionRequest(
            {
                model: "gpt-5.6-sol",
                stream: true,
                input: [
                    { type: "message", role: "developer", content: "instructions" },
                    {
                        type: "function_call",
                        call_id: "call-1",
                        name: "exec",
                        arguments: "{}",
                    },
                    {
                        type: "function_call_output",
                        call_id: "call-1",
                        output: "x".repeat(2_000),
                    },
                    { type: "message", role: "user", content: "recent request" },
                    { type: "compaction_trigger" },
                ],
            } as never,
            [],
            200,
        );

        expect(fitted.input).toContainEqual({
            type: "function_call_output",
            call_id: "call-1",
            output: "Output exceeded the available model context and was truncated",
        });
        expect(estimateCodexContextTokens(fitted, Number.MAX_SAFE_INTEGER)).toBeLessThan(200);
    });

    it("drops oldest history while retaining the current user and provider tool envelope", () => {
        const tools: SessionTool[] = [
            {
                name: "lookup",
                type: "local",
                description: "d".repeat(600),
            },
        ];
        const fitted = fitCodexCompactionRequest(
            {
                model: "gpt-5.6-sol",
                stream: true,
                input: [
                    { type: "message", role: "developer", content: "instructions" },
                    { type: "message", role: "user", content: `old-${"x".repeat(2_000)}` },
                    { type: "message", role: "assistant", content: "old response" },
                    { type: "message", role: "user", content: "current request" },
                    { type: "compaction_trigger" },
                ],
            } as never,
            tools,
            300,
        );

        const envelope = JSON.stringify(fitted);
        expect(envelope).not.toContain("old-");
        expect(envelope).toContain("current request");
        expect(
            estimateCodexContextTokens(
                createCodexCliSseRequest(fitted, tools),
                Number.MAX_SAFE_INTEGER,
            ),
        ).toBeLessThan(300);
    });

    it("counts UTF-8 bytes in the complete request envelope", () => {
        expect(
            estimateCodexContextTokens(
                {
                    input: "😀".repeat(100),
                    additional_tools: [{ description: "x".repeat(400) }],
                },
                10_000,
            ),
        ).toBeGreaterThanOrEqual(200);
    });
});
