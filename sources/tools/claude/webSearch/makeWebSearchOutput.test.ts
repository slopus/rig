import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";
import { describe, expect, it } from "vitest";

import { makeWebSearchOutput } from "./makeWebSearchOutput.js";

describe("makeWebSearchOutput", () => {
    it("collects result links and surrounding model text", () => {
        const blocks = [
            { type: "text", text: "Searching now." },
            { type: "server_tool_use", id: "server-1", name: "web_search", input: {} },
            {
                type: "web_search_tool_result",
                tool_use_id: "server-1",
                content: [
                    {
                        type: "web_search_result",
                        title: "Example",
                        url: "https://example.com",
                        encrypted_content: "encrypted",
                        page_age: null,
                    },
                ],
            },
            { type: "text", text: "The result is current." },
        ] as BetaContentBlock[];

        expect(makeWebSearchOutput(blocks, "example", 1.25)).toEqual({
            query: "example",
            results: [
                "Searching now.",
                {
                    tool_use_id: "server-1",
                    content: [{ title: "Example", url: "https://example.com" }],
                },
                "The result is current.",
            ],
            durationSeconds: 1.25,
        });
    });

    it("preserves server-side search errors for the caller", () => {
        const blocks = [
            {
                type: "web_search_tool_result",
                tool_use_id: "server-1",
                content: { type: "web_search_tool_result_error", error_code: "unavailable" },
            },
        ] as BetaContentBlock[];

        expect(makeWebSearchOutput(blocks, "example", 0).results).toEqual([
            "Web search error: unavailable",
        ]);
    });
});
