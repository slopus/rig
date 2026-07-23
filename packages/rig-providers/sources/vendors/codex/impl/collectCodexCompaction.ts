import type {
    ResponseCompactionItemParam,
    ResponseStreamEvent,
} from "openai/resources/responses/responses.js";

import type { SessionCacheUsage } from "@/core/SessionCacheUsage.js";
import { toSessionCacheUsage } from "@/responses/toSessionCacheUsage.js";

export interface CollectedCodexCompaction {
    readonly item: ResponseCompactionItemParam;
    readonly usage: SessionCacheUsage;
}

export async function collectCodexCompaction(
    stream: AsyncIterable<ResponseStreamEvent>,
    options: { signal?: AbortSignal; onOutputStarted?: () => void },
): Promise<CollectedCodexCompaction> {
    let item: ResponseCompactionItemParam | undefined;
    for await (const event of stream) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (event.type === "response.output_item.added") {
            options.onOutputStarted?.();
            continue;
        }
        if (event.type === "response.output_item.done" && event.item.type === "compaction") {
            if (item !== undefined)
                throw new Error("Compaction returned more than one compaction item.");
            item = {
                type: "compaction",
                encrypted_content: event.item.encrypted_content,
            };
            continue;
        }
        if (event.type === "response.incomplete") {
            const reason = event.response.incomplete_details?.reason ?? "unknown";
            throw new Error(`Incomplete compaction response returned, reason: ${reason}`);
        }
        if (event.type === "response.failed") {
            throw new Error(
                event.response.error?.message ??
                    event.response.incomplete_details?.reason ??
                    "Codex failed to compact the conversation.",
            );
        }
        if (event.type === "error") {
            throw new Error(
                event.code === null ? event.message : `${event.code}: ${event.message}`,
            );
        }
        if (event.type !== "response.completed") continue;
        const completedItems = event.response.output.filter(
            (output): output is typeof output & { type: "compaction" } =>
                output.type === "compaction",
        );
        if (completedItems.length > 1)
            throw new Error("Compaction returned more than one compaction item.");
        const completedItem = completedItems[0];
        const resolved =
            item ??
            (completedItem === undefined
                ? undefined
                : {
                      type: "compaction" as const,
                      encrypted_content: completedItem.encrypted_content,
                  });
        if (resolved === undefined)
            throw new Error("Compaction response did not contain a compaction item.");
        return {
            item: resolved,
            usage: toSessionCacheUsage(event.response.usage),
        };
    }
    throw new Error("Compaction response stream closed before completion.");
}
