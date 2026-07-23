const APPROXIMATE_BYTES_PER_TOKEN = 4;

/** Mirrors Codex's UTF-8, middle-preserving token-budget truncation. */
export function truncateCodexText(text: string, maxTokens: number): string {
    const source = Buffer.from(text);
    const maxBytes = maxTokens * APPROXIMATE_BYTES_PER_TOKEN;
    if (source.byteLength <= maxBytes) return text;

    const leftBudget = Math.floor(maxBytes / 2);
    const rightBudget = maxBytes - leftBudget;
    const prefix = decodePrefix(source, leftBudget);
    const suffix = decodeSuffix(source, rightBudget);
    const removedBytes = source.byteLength - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
    const removedTokens = Math.ceil(removedBytes / APPROXIMATE_BYTES_PER_TOKEN);
    return `${prefix}…${removedTokens} tokens truncated…${suffix}`;
}

function decodePrefix(source: Buffer, budget: number): string {
    let end = Math.min(budget, source.byteLength);
    for (;;) {
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(source.subarray(0, end));
        } catch {
            end -= 1;
        }
    }
}

function decodeSuffix(source: Buffer, budget: number): string {
    let start = Math.max(0, source.byteLength - budget);
    for (;;) {
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(source.subarray(start));
        } catch {
            start += 1;
        }
    }
}
