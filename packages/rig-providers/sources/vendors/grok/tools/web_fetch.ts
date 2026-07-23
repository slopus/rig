import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const web_fetch = {
    name: "web_fetch",
    type: "local",
    description:
        "Fetch the content of a specific URL and return it as markdown.\n\nIMPORTANT: web_fetch WILL FAIL for authenticated or private URLs (e.g. Google Docs, Confluence, Jira, GitHub private repos). Use specialized MCP tools for those instead.\n\nUsage notes:\n  - HTTP URLs will be automatically upgraded to HTTPS\n  - Long pages will be truncated to fit your context window",
    parameters: Type.Object(
        {
            url: Type.String({
                description: "The URL to fetch content from.",
            }),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "WebFetchInput",
        },
    ),
} as const satisfies SessionTool;
