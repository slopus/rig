import { requestAnthropicMessage } from "../../../providers/requestAnthropicMessage.js";
import { makeWebSearchOutput } from "./makeWebSearchOutput.js";
import type { WebSearchInput, WebSearchOutput } from "./types.js";

export async function performWebSearch(
    input: WebSearchInput,
    signal?: AbortSignal,
): Promise<WebSearchOutput> {
    const startedAt = performance.now();
    const response = await requestAnthropicMessage(
        {
            max_tokens: 4096,
            messages: [
                {
                    role: "user",
                    content: `Perform a web search for the query: ${input.query}`,
                },
            ],
            model: "claude-haiku-4-5-20251001",
            system: "You are an assistant for performing a web search tool use.",
            thinking: { type: "disabled" },
            tool_choice: { type: "tool", name: "web_search" },
            tools: [
                {
                    type: "web_search_20250305",
                    name: "web_search",
                    max_uses: 8,
                    ...(input.allowed_domains !== undefined
                        ? { allowed_domains: input.allowed_domains }
                        : {}),
                    ...(input.blocked_domains !== undefined
                        ? { blocked_domains: input.blocked_domains }
                        : {}),
                },
            ],
        },
        signal,
    );

    return makeWebSearchOutput(
        response.content,
        input.query,
        (performance.now() - startedAt) / 1000,
    );
}
