export function isCodexWebSocketUnavailableError(error: unknown): boolean {
    const details = readDetails(error, new Set());
    if (details.statuses.some((status) => status === 404 || status === 405 || status === 426))
        return true;
    return (
        details.statuses.includes(400) &&
        details.messages.some((message) =>
            /\bwebsocket\b.*\b(not supported|unsupported|unavailable|upgrade required)\b/i.test(
                message,
            ),
        )
    );
}

function readDetails(
    error: unknown,
    seen: Set<object>,
): { messages: string[]; statuses: number[] } {
    if (typeof error !== "object" || error === null || seen.has(error))
        return { messages: [], statuses: [] };
    seen.add(error);
    const nested =
        "cause" in error
            ? readDetails((error as { cause?: unknown }).cause, seen)
            : { messages: [], statuses: [] };
    const status =
        "status" in error && typeof (error as { status?: unknown }).status === "number"
            ? [(error as { status: number }).status]
            : [];
    const message =
        "message" in error && typeof (error as { message?: unknown }).message === "string"
            ? [(error as { message: string }).message]
            : [];
    return {
        messages: [...message, ...nested.messages],
        statuses: [...status, ...nested.statuses],
    };
}
