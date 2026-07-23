import type { SessionMessage } from "@/core/SessionContext.js";
import { extractGrokUserQuery } from "@/vendors/grok/impl/extractGrokUserQuery.js";

export function countGrokUserQueries(messages: readonly SessionMessage[]): number {
    return messages.filter((message) => extractGrokUserQuery(message) !== undefined).length;
}
