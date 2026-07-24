import { describe, expect, it, vi } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { createClaudeWebSearchTool } from "../../agent/tools/claude/WebSearch.js";
import { modelAnthropicFable5, modelAnthropicSonnet5 } from "@slopus/rig-execution";
import type { Model } from "@slopus/rig-execution";

describe("Claude Code WebSearch tool", () => {
    it("declares that network access requires Auto or Full access", () => {
        const tool = createClaudeWebSearchTool();

        expect(tool.requiresAutoOrFullAccess).toBe(true);
    });

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

        const result = await tool.execute(
            {
                query: "current docs 2026",
                allowed_domains: ["example.com"],
            },
            harness.context,
            {
                model: modelAnthropicFable5,
                provider: providerWithModels([modelAnthropicFable5, modelAnthropicSonnet5]),
            },
        );

        expect(search).toHaveBeenCalledWith(
            {
                query: "current docs 2026",
                allowed_domains: ["example.com"],
            },
            expect.objectContaining({ id: "work-claude" }),
            modelAnthropicSonnet5,
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
            tool.execute(
                {
                    query: "current docs 2026",
                    allowed_domains: [],
                    blocked_domains: [],
                },
                harness.context,
                {
                    model: modelAnthropicFable5,
                    provider: providerWithModels([modelAnthropicFable5]),
                },
            ),
        ).resolves.toMatchObject({ query: "current docs 2026" });
    });

    it("uses the selected provider's auxiliary query with the preferred model", async () => {
        const runClaudeAuxiliaryQuery = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "Current docs." }],
        });
        const tool = createClaudeWebSearchTool();
        const harness = createJustBashToolHarness();

        await tool.execute({ query: "current docs 2026" }, harness.context, {
            model: modelAnthropicFable5,
            provider: providerWithModels(
                [modelAnthropicFable5, modelAnthropicSonnet5],
                runClaudeAuxiliaryQuery,
            ),
        });

        expect(runClaudeAuxiliaryQuery).toHaveBeenCalledWith(
            modelAnthropicSonnet5,
            expect.objectContaining({
                prompt: "Perform a web search for the query: current docs 2026",
                tools: ["WebSearch"],
            }),
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
