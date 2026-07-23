import { formatGrokCompactionSummary } from "@/vendors/grok/impl/formatGrokCompactionSummary.js";

const MINIMUM_SUMMARY_CHARACTERS = 500;

export function isDegenerateGrokCompactionSummary(summary: string): boolean {
    return [...formatGrokCompactionSummary(summary)].length < MINIMUM_SUMMARY_CHARACTERS;
}
