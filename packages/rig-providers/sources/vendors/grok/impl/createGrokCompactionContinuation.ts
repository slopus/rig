import { formatGrokCompactionSummary } from "@/vendors/grok/impl/formatGrokCompactionSummary.js";

export function createGrokCompactionContinuation(summary: string): string {
    return (
        "This session is being continued from a previous conversation that ran out of " +
        "context. The summary below covers the earlier portion of the conversation.\n\n" +
        formatGrokCompactionSummary(summary)
    );
}
