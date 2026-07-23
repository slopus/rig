import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const web_search = {
    name: "web_search",
    type: "local",
    description:
        "Search the web for up-to-date information, tailored for coding and software development tasks.",
    parameters: Type.Object(
        {
            query: Type.String({
                description: "The search query to perform.",
            }),
            allowed_domains: Type.Optional(
                Type.Unsafe({
                    description: "Optional list of domains to restrict search to.",
                    type: ["array", "null"],
                    items: {
                        type: "string",
                    },
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "WebSearchInput",
        },
    ),
} as const satisfies SessionTool;
