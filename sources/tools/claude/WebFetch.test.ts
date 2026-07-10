import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { createClaudeWebFetchTool } from "./WebFetch.js";

describe("Claude Code WebFetch tool", () => {
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

        const result = await harness.runTool(tool, {
            url: "https://example.com/docs",
            prompt: "Return the title",
        });

        expect(fetchPage).toHaveBeenCalledWith("https://example.com/docs", undefined);
        expect(applyPrompt).toHaveBeenCalledWith("Return the title", "# Example", undefined, false);
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
});
