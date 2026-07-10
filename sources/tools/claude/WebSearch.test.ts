import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { createClaudeWebSearchTool } from "./WebSearch.js";

describe("Claude Code WebSearch tool", () => {
    it("runs a search and formats links for the model", async () => {
        const search = vi.fn().mockResolvedValue({
            query: "current docs 2026",
            results: [
                {
                    tool_use_id: "search-1",
                    content: [{ title: "Current docs", url: "https://example.com/docs" }],
                },
                "The current documentation is available.",
            ],
            durationSeconds: 0.5,
        });
        const tool = createClaudeWebSearchTool({ search });
        const harness = createJustBashToolHarness();

        const result = await harness.runTool(tool, {
            query: "current docs 2026",
            allowed_domains: ["example.com"],
        });

        expect(search).toHaveBeenCalledWith(
            {
                query: "current docs 2026",
                allowed_domains: ["example.com"],
            },
            undefined,
        );
        expect(tool.toLLM(result)[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining(
                'Links: [{"title":"Current docs","url":"https://example.com/docs"}]',
            ),
        });
        expect(tool.toLLM(result)[0]).toMatchObject({
            text: expect.stringContaining("MUST include the sources above"),
        });
    });

    it("validates mutually exclusive domain filters", async () => {
        const search = vi.fn();
        const tool = createClaudeWebSearchTool({ search });
        const harness = createJustBashToolHarness();

        await expect(
            harness.runTool(tool, {
                query: "current docs 2026",
                allowed_domains: ["example.com"],
                blocked_domains: ["example.org"],
            }),
        ).rejects.toThrow(/Cannot specify both allowed_domains and blocked_domains/);
        expect(search).not.toHaveBeenCalled();
    });

    it("allows empty domain filters", async () => {
        const search = vi.fn().mockResolvedValue({
            query: "current docs 2026",
            results: [],
            durationSeconds: 0,
        });
        const tool = createClaudeWebSearchTool({ search });
        const harness = createJustBashToolHarness();

        await expect(
            harness.runTool(tool, {
                query: "current docs 2026",
                allowed_domains: [],
                blocked_domains: [],
            }),
        ).resolves.toMatchObject({ query: "current docs 2026" });
    });
});
