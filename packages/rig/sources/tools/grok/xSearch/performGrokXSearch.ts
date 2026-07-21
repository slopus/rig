import { modelXaiGrok45 } from "../../../providers/models.js";
import type { Provider, TextContent, XSearchServerTool } from "../../../providers/types.js";
import type { XSearchInput, XSearchOutput } from "./types.js";

export async function performGrokXSearch(
    provider: Provider,
    input: XSearchInput,
    signal?: AbortSignal,
): Promise<XSearchOutput> {
    const model = provider.models.find((candidate) => candidate.id === modelXaiGrok45.id);
    if (model === undefined) {
        throw new Error("Grok 4.5 is not available for X search.");
    }

    const startedAt = performance.now();
    const serverTool: XSearchServerTool = {
        type: "x_search",
        ...(input.allowed_x_handles === undefined
            ? {}
            : { allowed_x_handles: input.allowed_x_handles }),
        ...(input.excluded_x_handles === undefined
            ? {}
            : { excluded_x_handles: input.excluded_x_handles }),
        ...(input.from_date === undefined ? {} : { from_date: input.from_date }),
        ...(input.to_date === undefined ? {} : { to_date: input.to_date }),
        ...(input.enable_image_understanding === undefined
            ? {}
            : { enable_image_understanding: input.enable_image_understanding }),
        ...(input.enable_video_understanding === undefined
            ? {}
            : { enable_video_understanding: input.enable_video_understanding }),
    };
    const stream = provider.stream(
        model,
        {
            messages: [{ role: "user", content: input.query, timestamp: Date.now() }],
            serverTools: [serverTool],
            systemPrompt:
                "Search X for the user's request. Return a concise synthesis with direct x.com links for the relevant posts. Use the native X search tool before answering.",
        },
        {
            ...(signal === undefined ? {} : { signal }),
            thinking: "low",
        },
    );

    for await (const event of stream) {
        if (event.type === "error") {
            throw new Error(event.error.errorMessage ?? "Grok 4.5 X search failed.");
        }
    }
    const message = await stream.result();
    const response = message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
    if (response.length === 0) {
        throw new Error("Grok 4.5 returned no X search results.");
    }

    return {
        query: input.query,
        response,
        durationSeconds: (performance.now() - startedAt) / 1000,
    };
}
