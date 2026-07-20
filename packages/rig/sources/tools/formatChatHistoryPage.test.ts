import { describe, expect, it } from "vitest";

import type { ChatHistoryPage } from "../agent/index.js";
import { formatChatHistoryPage } from "./formatChatHistoryPage.js";

describe("formatChatHistoryPage", () => {
    it("prioritizes conversation and thinking while bounding tool details", () => {
        const page: ChatHistoryPage = {
            agent: {
                messageCount: 2,
                path: "/root",
                sessionId: "root",
                status: "idle",
            },
            agents: [],
            cursor: 0,
            matchedMessages: 2,
            matchedStats: emptyStats(),
            messages: [
                {
                    message: {
                        blocks: [{ text: "Please preserve this request.", type: "text" }],
                        id: "user",
                        role: "user",
                    },
                    position: 0,
                },
                {
                    message: {
                        blocks: [
                            { thinking: "Important private reasoning.", type: "thinking" },
                            { text: "Important assistant response.", type: "text" },
                            {
                                arguments: { payload: "a".repeat(3_000) },
                                id: "call",
                                name: "exec_command",
                                type: "tool_call",
                            },
                            {
                                display: "Command completed.",
                                rendered: [{ text: `prefix-${"b".repeat(8_000)}`, type: "text" }],
                                toolCallId: "call",
                                toolName: "exec_command",
                                type: "tool_result",
                            },
                        ],
                        id: "agent",
                        providerId: "codex",
                        requestedModelId: "openai/gpt",
                        role: "agent",
                        usage: zeroUsage(),
                    },
                    position: 1,
                },
            ],
            totalStats: emptyStats(),
            totalMessages: 2,
        };

        const result = formatChatHistoryPage(page);

        expect(result.history).toContain("Please preserve this request.");
        expect(result.history).toContain("Important private reasoning.");
        expect(result.history).toContain("Important assistant response.");
        expect(result.history).toContain("Tool call: exec_command");
        expect(result.history).toContain("Tool result: exec_command (ok)");
        expect(result.history).toContain("[truncated");
        expect(result.history.length).toBeLessThan(25_000);
        expect(result.stats).toMatchObject({
            assistantMessages: 1,
            messages: 2,
            thinkingBlocks: 1,
            toolCalls: 1,
            toolResults: 1,
            userMessages: 1,
        });

        const withoutTools = formatChatHistoryPage(page, { includeTools: false });
        expect(withoutTools.history).toContain("Important private reasoning.");
        expect(withoutTools.history).not.toContain("Tool call:");
        expect(withoutTools.history).not.toContain("Tool result:");
    });

    it("keeps the latest messages when an end page exceeds the output bound", () => {
        const messages = Array.from({ length: 8 }, (_, position) => ({
            message: {
                blocks: [
                    {
                        text: `message-${position + 1}-${"x".repeat(12_000)}`,
                        type: "text" as const,
                    },
                ],
                id: `message-${position + 1}`,
                role: "user" as const,
            },
            position,
        }));
        const page: ChatHistoryPage = {
            agent: { messageCount: 8, path: "/root", sessionId: "root", status: "idle" },
            agents: [],
            cursor: 0,
            matchedMessages: 8,
            matchedStats: emptyStats(),
            messages,
            totalMessages: 8,
            totalStats: emptyStats(),
        };

        const result = formatChatHistoryPage(page, { fromEnd: true });

        expect(result.startIndex).toBeGreaterThan(0);
        expect(result.history).not.toContain("message-1-");
        expect(result.history).toContain("message-8-");
        expect(result.history.length).toBeLessThanOrEqual(80_000);
    });

    it("includes truncation metadata without exceeding the per-block text limit", () => {
        const page: ChatHistoryPage = {
            agent: { messageCount: 1, path: "/root", sessionId: "root", status: "idle" },
            agents: [],
            cursor: 0,
            matchedMessages: 1,
            matchedStats: emptyStats(),
            messages: [
                {
                    message: {
                        blocks: [{ text: "x".repeat(200_000), type: "text" }],
                        id: "large",
                        role: "user",
                    },
                    position: 0,
                },
            ],
            totalMessages: 1,
            totalStats: emptyStats(),
        };

        const result = formatChatHistoryPage(page);

        expect(result.history).toContain("[truncated");
        expect(result.history.length).toBeLessThanOrEqual(
            "1. USER\n".length + "Text: ".length + 12_000,
        );
    });
});

function zeroUsage() {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
    };
}

function emptyStats() {
    return {
        assistantMessages: 0,
        messages: 0,
        textCharacters: 0,
        thinkingBlocks: 0,
        toolCalls: 0,
        toolResults: 0,
        userMessages: 0,
    };
}
