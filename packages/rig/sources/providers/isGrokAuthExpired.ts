import type { GrokAuthRecord } from "./grok-auth-types.js";

const FALLBACK_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function isGrokAuthExpired(
    record: GrokAuthRecord,
    options: { earlyInvalidationMs?: number; now?: number } = {},
): boolean {
    const now = options.now ?? Date.now();
    const buffer = options.earlyInvalidationMs ?? 0;
    const expiresAt = parseTime(record.expires_at);
    if (expiresAt !== undefined) return now >= expiresAt - buffer;

    const createdAt = parseTime(record.create_time);
    return createdAt === undefined || now >= createdAt + FALLBACK_TOKEN_TTL_MS - buffer;
}

function parseTime(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
