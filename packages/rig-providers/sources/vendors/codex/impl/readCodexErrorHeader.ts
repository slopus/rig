export function readCodexErrorHeader(error: unknown, name: string): string | undefined {
    return readHeader(error, name.toLowerCase(), new Set());
}

function readHeader(
    error: unknown,
    name: string,
    seen: Set<object>,
): string | undefined {
    if (typeof error !== "object" || error === null || seen.has(error)) return undefined;
    seen.add(error);
    if ("headers" in error) {
        const headers = (error as { headers?: unknown }).headers;
        if (typeof Headers !== "undefined" && headers instanceof Headers) {
            const value = headers.get(name);
            if (value !== null) return value;
        } else if (typeof headers === "object" && headers !== null) {
            const record = headers as Record<string, unknown>;
            const value =
                record[name] ??
                Object.entries(record).find(([key]) => key.toLowerCase() === name)?.[1];
            if (typeof value === "string") return value;
        }
    }
    return "cause" in error
        ? readHeader((error as { cause?: unknown }).cause, name, seen)
        : undefined;
}
