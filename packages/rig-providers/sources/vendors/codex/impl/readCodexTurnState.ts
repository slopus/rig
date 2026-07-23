export function readCodexTurnState(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) return undefined;
    const record = event as Record<string, unknown>;
    if (record.type !== "response.metadata" && record.type !== "codex.response.metadata") {
        return undefined;
    }
    const headers = record.headers;
    if (typeof headers !== "object" || headers === null) return undefined;
    const value = Object.entries(headers).find(
        ([name]) => name.toLowerCase() === "x-codex-turn-state",
    )?.[1];
    return typeof value === "string" ? value : undefined;
}
