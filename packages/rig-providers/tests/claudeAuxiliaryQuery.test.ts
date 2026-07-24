import { describe, expect, it, vi } from "vitest";

import { ClaudeAuthTokenCredential, ClaudeProvider, type ClaudeSdkQuery } from "@/index.js";

describe("Claude auxiliary query", () => {
    it("uses the selected Claude provider credential, model, and built-in tools", async () => {
        const credential = await ClaudeAuthTokenCredential.tryLoad({
            authToken: "selected-provider-token",
        });
        if (credential === null) throw new Error("Expected test credential.");
        let captured: Parameters<ClaudeSdkQuery>[0] | undefined;
        const query = vi.fn<ClaudeSdkQuery>((parameters) => {
            captured = parameters;
            return fakeQuery();
        });
        const provider = new ClaudeProvider({
            credential,
            cwd: "/tmp/rig-claude-auxiliary-test",
            env: {
                ANTHROPIC_AUTH_TOKEN: "unselected-global-token",
                PATH: process.env.PATH,
            },
            query,
        });

        await expect(
            provider.runAuxiliaryQuery("anthropic/sonnet-5", {
                prompt: "Search for current docs.",
                systemPrompt: "Search the web.",
                tools: ["WebSearch"],
            }),
        ).resolves.toEqual({
            content: [{ type: "text", text: "Current docs." }],
        });

        expect(captured?.prompt).toBe("Search for current docs.");
        expect(captured?.options).toMatchObject({
            allowedTools: ["WebSearch"],
            model: "sonnet[1m]",
            tools: ["WebSearch"],
            env: {
                ANTHROPIC_AUTH_TOKEN: "selected-provider-token",
            },
        });
    });
});

function fakeQuery(): ReturnType<ClaudeSdkQuery> {
    async function* messages() {
        yield {
            type: "assistant",
            message: {
                id: "message-id",
                type: "message",
                role: "assistant",
                model: "claude-sonnet-5",
                content: [{ type: "text", text: "Current docs." }],
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: {
                    input_tokens: 1,
                    output_tokens: 1,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
            },
            parent_tool_use_id: null,
            uuid: "assistant-id",
            session_id: "session-id",
        };
        yield {
            type: "result",
            subtype: "success",
            duration_ms: 1,
            duration_api_ms: 1,
            is_error: false,
            num_turns: 1,
            result: "Current docs.",
            stop_reason: "end_turn",
            total_cost_usd: 0,
            usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
            modelUsage: {},
            permission_denials: [],
            uuid: "result-id",
            session_id: "session-id",
        };
    }
    return Object.assign(messages(), { close: () => {} }) as unknown as ReturnType<ClaudeSdkQuery>;
}
