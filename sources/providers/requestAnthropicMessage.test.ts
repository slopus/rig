import { afterEach, describe, expect, it, vi } from "vitest";

import { requestAnthropicMessage } from "./requestAnthropicMessage.js";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("requestAnthropicMessage", () => {
    it("uses Claude Code OAuth credentials in a native Messages API request", async () => {
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-token");
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ content: [{ type: "text", text: "Done" }] }), {
                status: 200,
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            requestAnthropicMessage({ model: "claude-haiku-4-5-20251001" }),
        ).resolves.toEqual({ content: [{ type: "text", text: "Done" }] });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.anthropic.com/v1/messages?beta=true",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: "Bearer oauth-token",
                    "anthropic-beta": "oauth-2025-04-20",
                    "anthropic-version": "2023-06-01",
                }),
            }),
        );
    });

    it("surfaces API errors without returning malformed content", async () => {
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-token");
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockResolvedValue(
                new Response(JSON.stringify({ error: { message: "Search is unavailable" } }), {
                    status: 503,
                    statusText: "Service Unavailable",
                }),
            ),
        );

        await expect(requestAnthropicMessage({})).rejects.toThrow(
            "Anthropic request failed: Search is unavailable",
        );
    });
});
