const APPROXIMATE_BYTES_PER_TOKEN = 4;

/** Conservative UTF-8 estimate of the final model-visible request envelope. */
export function estimateCodexContextTokens(envelope: unknown, tokenLimit: number): number {
    const bytes = Buffer.byteLength(JSON.stringify(envelope));
    return Math.min(tokenLimit, Math.ceil(bytes / APPROXIMATE_BYTES_PER_TOKEN));
}
