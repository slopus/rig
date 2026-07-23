import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";
import {
    ClaudeApiKeyCredential,
    ClaudeAuthTokenCredential,
    ClaudeOAuthCredential,
} from "@slopus/rig-providers";

export interface AnthropicMessageResponse {
    content: BetaContentBlock[];
}

export async function requestAnthropicMessage(
    body: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<AnthropicMessageResponse> {
    const credential =
        (await ClaudeApiKeyCredential.tryLoad({ env: process.env })) ??
        (await ClaudeAuthTokenCredential.tryLoad({ env: process.env })) ??
        (await ClaudeOAuthCredential.tryLoad({ env: process.env }));
    if (credential === null) {
        throw new Error(
            "Anthropic authentication is required for web tools. Sign in with Claude Code or set ANTHROPIC_API_KEY.",
        );
    }

    const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(
        /\/$/,
        "",
    );
    const response = await fetch(`${baseUrl}/v1/messages?beta=true`, {
        body: JSON.stringify(body),
        headers: {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "User-Agent": "rig",
            "x-app": "cli",
            ...(credential.name === "claude-oauth"
                ? {
                      "anthropic-beta": "oauth-2025-04-20",
                      Authorization: `Bearer ${credential.credential.accessToken}`,
                  }
                : credential.name === "claude-auth-token"
                  ? { Authorization: `Bearer ${credential.credential.authToken}` }
                  : { "x-api-key": credential.credential.apiKey }),
        },
        method: "POST",
        ...(signal !== undefined ? { signal } : {}),
    });

    let payload: {
        content?: unknown;
        error?: { message?: unknown };
    };
    try {
        payload = (await response.json()) as typeof payload;
    } catch {
        if (!response.ok) {
            throw new Error(`Anthropic request failed: ${response.status} ${response.statusText}`);
        }
        throw new Error("Anthropic returned an invalid message response");
    }
    if (!response.ok) {
        const message =
            typeof payload.error?.message === "string"
                ? payload.error.message
                : `${response.status} ${response.statusText}`;
        throw new Error(`Anthropic request failed: ${message}`);
    }
    if (!Array.isArray(payload.content)) {
        throw new Error("Anthropic returned an invalid message response");
    }
    return { content: payload.content as BetaContentBlock[] };
}
