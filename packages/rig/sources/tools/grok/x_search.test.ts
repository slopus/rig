import { describe, expect, it, vi } from "vitest";

import { createGrokProvider } from "../../providers/grok.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { createGrokXSearchTool } from "./x_search.js";

describe("Grok X search tool", () => {
    it("owns review of its external xAI boundary", () => {
        const tool = createGrokXSearchTool({ provider: createGrokProvider() });
        const harness = createJustBashToolHarness();

        expect(tool.requiresAutoOrFullAccess).toBe(true);
        expect(tool.shouldReviewInAutoMode({ query: "recent xAI posts" }, harness.context)).toBe(
            true,
        );
    });

    it("passes filters to Grok 4.5 and returns its linked synthesis", async () => {
        const search = vi.fn().mockResolvedValue({
            query: "recent xAI posts",
            response: "Recent post: https://x.com/xai/status/123",
            durationSeconds: 0.25,
        });
        const tool = createGrokXSearchTool({ provider: createGrokProvider(), search });
        const harness = createJustBashToolHarness();

        const result = await harness.runTool(tool, {
            query: "  recent xAI posts  ",
            allowed_x_handles: ["xai"],
            from_date: "2026-07-01",
            enable_image_understanding: true,
        });

        expect(search).toHaveBeenCalledWith(
            {
                query: "recent xAI posts",
                allowed_x_handles: ["xai"],
                from_date: "2026-07-01",
                enable_image_understanding: true,
            },
            undefined,
        );
        expect(tool.toLLM(result)).toEqual([
            { type: "text", text: "Recent post: https://x.com/xai/status/123" },
        ]);
        expect(tool.toUI(result, { query: "recent xAI posts" })).toBe(
            "Completed X search in 250ms",
        );
    });

    it("rejects conflicting account filters", async () => {
        const search = vi.fn();
        const tool = createGrokXSearchTool({ provider: createGrokProvider(), search });
        const harness = createJustBashToolHarness();

        await expect(
            harness.runTool(tool, {
                query: "recent xAI posts",
                allowed_x_handles: ["xai"],
                excluded_x_handles: ["grok"],
            }),
        ).rejects.toThrow(/Cannot specify both allowed_x_handles and excluded_x_handles/);
        expect(search).not.toHaveBeenCalled();
    });

    it("rejects reversed date ranges", async () => {
        const search = vi.fn();
        const tool = createGrokXSearchTool({ provider: createGrokProvider(), search });
        const harness = createJustBashToolHarness();

        await expect(
            harness.runTool(tool, {
                query: "recent xAI posts",
                from_date: "2026-07-20",
                to_date: "2026-07-01",
            }),
        ).rejects.toThrow(/from_date must be on or before to_date/);
        expect(search).not.toHaveBeenCalled();
    });
});
