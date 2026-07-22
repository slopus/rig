export interface CodexBedrockRequestMetadata {
    clientMetadata: Record<string, string>;
    headers: Record<string, string>;
}

export function createCodexBedrockRequestMetadata(options: {
    agentId: string;
    installationId: string;
    turnId: string;
    turnStartedAt: number;
}): CodexBedrockRequestMetadata {
    const windowId = `${options.agentId}:0`;
    const turnMetadata = JSON.stringify({
        installation_id: options.installationId,
        session_id: options.agentId,
        thread_id: options.agentId,
        turn_id: options.turnId,
        window_id: windowId,
        request_kind: "turn",
        thread_source: "user",
        sandbox: "seatbelt",
        turn_started_at_unix_ms: options.turnStartedAt,
    });
    return {
        clientMetadata: {
            turn_id: options.turnId,
            session_id: options.agentId,
            thread_id: options.agentId,
            "x-codex-installation-id": options.installationId,
            "x-codex-window-id": windowId,
            "x-codex-turn-metadata": turnMetadata,
        },
        headers: {
            "x-codex-window-id": windowId,
            "x-codex-turn-metadata": turnMetadata,
            "x-client-request-id": options.agentId,
            "session-id": options.agentId,
            "thread-id": options.agentId,
        },
    };
}
