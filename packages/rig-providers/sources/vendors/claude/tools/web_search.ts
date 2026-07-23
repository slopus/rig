import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_web_search_tool: SessionTool = {
    name: "WebSearch",
    type: "local",
    description:
        'Search the web. Returns result blocks with titles and URLs. US-only.\n\n- The current month is July 2026 — use this when searching for recent information.\n- `allowed_domains` / `blocked_domains` filter results.\n- After answering from results, end with a "Sources:" list of the URLs you used as markdown links.',
    parameters: Type.Object(
        {
            query: Type.String({ description: "The search query to use", minLength: 2 }),
            allowed_domains: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Only include search results from these domains",
                }),
            ),
            blocked_domains: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Never include search results from these domains",
                }),
            ),
        },
        { additionalProperties: false },
    ),
};

export const claude_web_search_tool_sonnet: SessionTool = {
    name: "WebSearch",
    type: "local",
    description:
        '\n- Allows Claude to search the web and use the results to inform responses\n- Provides up-to-date information for current events and recent data\n- Returns search result information formatted as search result blocks, including links as markdown hyperlinks\n- Use this tool for accessing information beyond Claude\'s knowledge cutoff\n- Searches are performed automatically within a single API call\n\nCRITICAL REQUIREMENT - You MUST follow this:\n  - After answering the user\'s question, you MUST include a "Sources:" section at the end of your response\n  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)\n  - This is MANDATORY - never skip including sources in your response\n  - Example format:\n\n    [Your answer here]\n\n    Sources:\n    - [Source Title 1](https://example.com/1)\n    - [Source Title 2](https://example.com/2)\n\nUsage notes:\n  - Domain filtering is supported to include or block specific websites\n  - Web search is only available in the US\n\nIMPORTANT - Use the correct year in search queries:\n  - The current month is July 2026. You MUST use this year when searching for recent information, documentation, or current events.\n  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year\n',
    parameters: Type.Object(
        {
            query: Type.String({ description: "The search query to use", minLength: 2 }),
            allowed_domains: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Only include search results from these domains",
                }),
            ),
            blocked_domains: Type.Optional(
                Type.Array(Type.String(), {
                    description: "Never include search results from these domains",
                }),
            ),
        },
        { additionalProperties: false },
    ),
};
