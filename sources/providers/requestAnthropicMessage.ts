import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";

import { readClaudeCodeOAuthToken } from "./readClaudeCodeOAuthToken.js";

export interface AnthropicMessageResponse {
    content: BetaContentBlock[];
}

export async function requestAnthropicMessage(
    body: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<AnthropicMessageResponse> {
    const oauthToken = await readClaudeCodeOAuthToken();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const bearerToken = oauthToken ?? process.env.ANTHROPIC_AUTH_TOKEN;
    if (bearerToken === undefined && apiKey === undefined) {
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
            ...(oauthToken !== undefined ? { "anthropic-beta": "oauth-2025-04-20" } : {}),
            ...(bearerToken !== undefined
                ? { Authorization: `Bearer ${bearerToken}` }
                : { "x-api-key": apiKey ?? "" }),
        },
        method: "POST",
        ...(signal !== undefined ? { signal } : {}),
    });

    const payload = (await response.json()) as {
        content?: unknown;
        error?: { message?: unknown };
    };
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
