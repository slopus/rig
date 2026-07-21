import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { quoteVisibleExact } from "../../permissions/quoteVisibleExact.js";
import { performGrokXSearch } from "./xSearch/performGrokXSearch.js";
import type { XSearchInput, XSearchOutput } from "./xSearch/types.js";
import type { Provider } from "../../providers/types.js";

const xSearchReturnSchema = Type.Object({
    query: Type.String({ description: "The X search query that was executed" }),
    response: Type.String({ description: "Grok's synthesis with direct X links" }),
    durationSeconds: Type.Number({ description: "Time taken to complete the search" }),
});

export interface GrokXSearchDependencies {
    provider: Provider;
    search?: (input: XSearchInput, signal?: AbortSignal) => Promise<XSearchOutput>;
}

export function createGrokXSearchTool(dependencies: GrokXSearchDependencies) {
    const search =
        dependencies.search ??
        ((input: XSearchInput, signal?: AbortSignal) =>
            performGrokXSearch(dependencies.provider, input, signal));

    return defineTool({
        name: "x_search",
        label: "X search",
        description: `Search X for current posts and conversations using Grok 4.5.
- Use for recent posts, accounts, threads, and discussion on X
- Returns a concise synthesis with direct x.com links
- Supports account, date, image, and video filters
- Do not use both allowed_x_handles and excluded_x_handles in one request`,
        arguments: Type.Object({
            query: Type.String({ minLength: 2, description: "What to search for on X" }),
            allowed_x_handles: Type.Optional(
                Type.Array(Type.String({ minLength: 1 }), {
                    description: "Only search posts from these X handles, without @",
                    maxItems: 20,
                }),
            ),
            excluded_x_handles: Type.Optional(
                Type.Array(Type.String({ minLength: 1 }), {
                    description: "Exclude posts from these X handles, without @",
                    maxItems: 20,
                }),
            ),
            from_date: Type.Optional(
                Type.String({
                    description: "Earliest post date in YYYY-MM-DD format",
                    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                }),
            ),
            to_date: Type.Optional(
                Type.String({
                    description: "Latest post date in YYYY-MM-DD format",
                    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                }),
            ),
            enable_image_understanding: Type.Optional(
                Type.Boolean({ description: "Analyze images attached to matching posts" }),
            ),
            enable_video_understanding: Type.Optional(
                Type.Boolean({ description: "Analyze videos attached to matching posts" }),
            ),
        }),
        returnType: xSearchReturnSchema,
        requiresAutoOrFullAccess: true,
        describeAutoPermissionAction: ({ query }) =>
            `searching X for ${quoteVisibleExact(query)}. Access: xAI network service outside Rig’s shell sandbox`,
        shouldReviewInAutoMode: () => true,
        execute: async (input, _context, execution) => {
            const query = input.query.trim();
            if (query.length < 2) {
                throw new Error("Error: X search query must contain at least two characters");
            }
            if (input.allowed_x_handles?.length && input.excluded_x_handles?.length) {
                throw new Error(
                    "Error: Cannot specify both allowed_x_handles and excluded_x_handles in the same request",
                );
            }
            if (input.from_date !== undefined && input.to_date !== undefined) {
                if (input.from_date > input.to_date) {
                    throw new Error("Error: from_date must be on or before to_date");
                }
            }

            return search({ ...input, query }, execution.signal);
        },
        toLLM: (result) => [{ type: "text", text: result.response }],
        toUI: (result) => {
            const duration =
                result.durationSeconds >= 1
                    ? `${Math.round(result.durationSeconds)}s`
                    : `${Math.round(result.durationSeconds * 1000)}ms`;
            return `Completed X search in ${duration}`;
        },
        locks: [],
    });
}
