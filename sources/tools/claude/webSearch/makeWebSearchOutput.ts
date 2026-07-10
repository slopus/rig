import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";

import type { WebSearchOutput, WebSearchResult } from "./types.js";

export function makeWebSearchOutput(
    blocks: BetaContentBlock[],
    query: string,
    durationSeconds: number,
): WebSearchOutput {
    const results: Array<WebSearchResult | string> = [];
    let text = "";
    let inText = true;

    for (const block of blocks) {
        if (block.type === "server_tool_use") {
            if (inText && text.trim().length > 0) {
                results.push(text.trim());
            }
            text = "";
            inText = false;
            continue;
        }

        if (block.type === "web_search_tool_result") {
            if (!Array.isArray(block.content)) {
                results.push(`Web search error: ${block.content.error_code}`);
            } else {
                results.push({
                    tool_use_id: block.tool_use_id,
                    content: block.content.map((hit) => ({
                        title: hit.title,
                        url: hit.url,
                    })),
                });
            }
        }

        if (block.type === "text") {
            if (!inText) {
                text = "";
            }
            inText = true;
            text += block.text;
        }
    }

    if (text.trim().length > 0) {
        results.push(text.trim());
    }
    return { query, results, durationSeconds };
}
