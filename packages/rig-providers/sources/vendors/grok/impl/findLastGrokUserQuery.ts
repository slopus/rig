import type { SessionMessage } from "@/core/SessionContext.js";
import { extractGrokUserQuery } from "@/vendors/grok/impl/extractGrokUserQuery.js";

export function findLastGrokUserQuery(
    messages: readonly SessionMessage[],
): SessionMessage | undefined {
    return [...messages].reverse().find((message) => extractGrokUserQuery(message) !== undefined);
}
