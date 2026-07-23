export function createCodexClientMetadata(options: {
    installationId: string;
    requestKind: "turn";
    sessionId: string;
    turnId: string;
    windowId: string;
}): Record<string, string> {
    const turnMetadata = {
        installation_id: options.installationId,
        session_id: options.sessionId,
        thread_id: options.sessionId,
        turn_id: options.turnId,
        window_id: options.windowId,
        request_kind: options.requestKind,
    };
    return {
        turn_id: options.turnId,
        "x-codex-turn-metadata": JSON.stringify(turnMetadata),
        "x-codex-installation-id": options.installationId,
        session_id: options.sessionId,
        thread_id: options.sessionId,
        "x-codex-window-id": options.windowId,
    };
}
