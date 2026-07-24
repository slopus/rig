const PREVIOUS_RESPONSE_NOT_FOUND = "previous_response_not_found";

export function isCodexPreviousResponseNotFoundError(error: unknown): boolean {
    const seen = new Set<object>();
    const matches = (value: unknown): boolean => {
        if (typeof value === "string") return value.includes(PREVIOUS_RESPONSE_NOT_FOUND);
        if (typeof value !== "object" || value === null || seen.has(value)) return false;
        seen.add(value);
        const record = value as Record<string, unknown>;
        if (record.code === PREVIOUS_RESPONSE_NOT_FOUND) return true;
        return [record.error, record.cause, record.body, record.message].some(matches);
    };
    return matches(error);
}
