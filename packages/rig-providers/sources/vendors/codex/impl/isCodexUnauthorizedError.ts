export function isCodexUnauthorizedError(error: unknown): boolean {
    return hasUnauthorized(error, new Set());
}

function hasUnauthorized(error: unknown, seen: Set<object>): boolean {
    if (typeof error !== "object" || error === null || seen.has(error)) return false;
    seen.add(error);
    if ("status" in error && error.status === 401) return true;
    return "cause" in error && hasUnauthorized(error.cause, seen);
}
