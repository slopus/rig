import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { createClaudeWebFetchTool } from "../../agent/tools/claude/WebFetch.js";
import { modelAnthropicFable5, modelAnthropicOpus48 } from "@slopus/rig-execution";
import type { Model } from "@slopus/rig-execution";

describe("Claude Code WebFetch tool", () => {
    it("declares that network access requires Auto or Full access", () => {
        const tool = createClaudeWebFetchTool();

        expect(tool.requiresAutoOrFullAccess).toBe(true);
    });

    it("fetches content and applies the requested prompt", async () => {
        const fetchPage = vi.fn().mockResolvedValue({
            bytes: 42,
            code: 200,
            codeText: "OK",
            content: "# Example",
            contentType: "text/html",
        });
        const applyPrompt = vi.fn().mockResolvedValue("The title is Example.");
        const tool = createClaudeWebFetchTool({
            fetchPage,
            applyPrompt,
            now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125),
        });
        const harness = createJustBashToolHarness();

        const result = await tool.execute(
            {
                url: "https://example.com/docs",
                prompt: "Return the title",
            },
            harness.context,
            {
                model: modelAnthropicFable5,
                provider: providerWithModels([modelAnthropicFable5, modelAnthropicOpus48]),
            },
        );

        expect(fetchPage).toHaveBeenCalledWith("https://example.com/docs", undefined);
        expect(applyPrompt).toHaveBeenCalledWith(
            "Return the title",
            "# Example",
            expect.objectContaining({ id: "work-claude" }),
            modelAnthropicOpus48,
            undefined,
            false,
        );
        expect(result).toEqual({
            bytes: 42,
            code: 200,
            codeText: "OK",
            result: "The title is Example.",
            durationMs: 25,
            url: "https://example.com/docs",
        });
        expect(tool.toLLM(result)).toEqual([{ type: "text", text: "The title is Example." }]);
    });

    it("returns cross-host redirects for a follow-up fetch", async () => {
        const tool = createClaudeWebFetchTool({
            fetchPage: vi.fn().mockResolvedValue({
                type: "redirect",
                originalUrl: "https://example.com/start",
                redirectUrl: "https://docs.example.org/end",
                statusCode: 302,
            }),
            now: vi.fn().mockReturnValue(100),
        });
        const harness = createJustBashToolHarness();

        const result = await harness.runTool(tool, {
            url: "https://example.com/start",
            prompt: "Summarize",
        });

        expect(result.code).toBe(302);
        expect(result.codeText).toBe("Found");
        expect(result.result).toContain("Redirect URL: https://docs.example.org/end");
        expect(result.result).toContain('- prompt: "Summarize"');
    });

    it("returns short Markdown directly for preapproved documentation sites", async () => {
        const applyPrompt = vi.fn();
        const tool = createClaudeWebFetchTool({
            fetchPage: vi.fn().mockResolvedValue({
                bytes: 9,
                code: 200,
                codeText: "OK",
                content: "# React\n",
                contentType: "text/markdown",
            }),
            applyPrompt,
        });
        const harness = createJustBashToolHarness();

        const result = await harness.runTool(tool, {
            url: "https://react.dev/reference",
            prompt: "Summarize",
        });

        expect(result.result).toBe("# React\n");
        expect(applyPrompt).not.toHaveBeenCalled();
    });

    it("rejects malformed URLs before fetching", async () => {
        const fetchPage = vi.fn();
        const tool = createClaudeWebFetchTool({ fetchPage });
        const harness = createJustBashToolHarness();

        await expect(
            harness.runTool(tool, { url: "not a URL", prompt: "Summarize" }),
        ).rejects.toThrow("Invalid URL");
        expect(fetchPage).not.toHaveBeenCalled();
    });

    it("summarizes through the selected provider with the preferred model", async () => {
        const runClaudeAuxiliaryQuery = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Selected provider summary." }],
        });
        const tool = createClaudeWebFetchTool({
            fetchPage: vi.fn().mockResolvedValue({
                bytes: 42,
                code: 200,
                codeText: "OK",
                content: "# Example",
                contentType: "text/html",
            }),
        });
        const harness = createJustBashToolHarness();

        const result = await tool.execute(
            { url: "https://example.com/docs", prompt: "Summarize" },
            harness.context,
            {
                model: modelAnthropicFable5,
                provider: providerWithModels(
                    [modelAnthropicFable5, modelAnthropicOpus48],
                    runClaudeAuxiliaryQuery,
                ),
            },
        );

        expect(result.result).toBe("Selected provider summary.");
        expect(runClaudeAuxiliaryQuery).toHaveBeenCalledWith(
            modelAnthropicOpus48,
            expect.objectContaining({ systemPrompt: "" }),
        );
    });
});

function providerWithModels(
    models: readonly Model[],
    runClaudeAuxiliaryQuery?: NonNullable<
        import("@slopus/rig-execution").Provider["runClaudeAuxiliaryQuery"]
    >,
) {
    return {
        id: "work-claude",
        type: "claude" as const,
        models,
        serviceTiers: undefined,
        extendProfilePromptContext: undefined,
        quota: undefined,
        ...(runClaudeAuxiliaryQuery === undefined ? {} : { runClaudeAuxiliaryQuery }),
        stream: () => {
            throw new Error("Not used");
        },
    };
}
