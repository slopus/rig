export function readCodexTurnStateHeader(headers: Headers): string | undefined {
    return headers.get("x-codex-turn-state") ?? undefined;
}
