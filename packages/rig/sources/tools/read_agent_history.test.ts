import { describe, expect, it, vi } from "vitest";

import type { AgentContext, ChatHistoryPage } from "../agent/index.js";
import { readAgentHistoryTool } from "./read_agent_history.js";

describe("read_agent_history", () => {
    it("reads a selected subagent and lists the complete session tree", () => {
        const page: ChatHistoryPage = {
            agent: {
                description: "Inspect history",
                messageCount: 1,
                path: "/root/audit",
                sessionId: "child",
                status: "completed",
            },
            agents: [
                {
                    messageCount: 4,
                    path: "/root",
                    sessionId: "root",
                    status: "idle",
                },
                {
                    description: "Inspect history",
                    messageCount: 1,
                    path: "/root/audit",
                    sessionId: "child",
                    status: "completed",
                },
            ],
            cursor: 0,
            matchedMessages: 1,
            matchedStats: stats({ assistantMessages: 1, messages: 1 }),
            messages: [
                {
                    message: {
                        blocks: [{ text: "Subagent result.", type: "text" }],
                        id: "child-answer",
                        role: "agent",
                        usage: zeroUsage(),
                    },
                    position: 0,
                },
            ],
            totalStats: stats({ assistantMessages: 1, messages: 1 }),
            totalMessages: 1,
        };
        const read = vi.fn(() => page);
        const context = { chatHistory: { read } } as unknown as AgentContext;

        expect(readAgentHistoryTool.name).toBe("read_agent_history");
        expect(readAgentHistoryTool.description).toContain("low-level inference history");
        expect(readAgentHistoryTool.description).toContain("80,000 characters");
        expect(readAgentHistoryTool.description).toContain("hidden reasoning");
        expect(readAgentHistoryTool.arguments.properties.limit.maximum).toBe(500);
        expect(readAgentHistoryTool.arguments.properties.limit.description).toContain(
            "may return fewer",
        );

        const result = readAgentHistoryTool.execute(
            {
                from: "end",
                include_tools: false,
                limit: 20,
                query: "result",
                roles: ["assistant"],
                target: "/root/audit",
            },
            context,
            {},
        );

        expect(read).toHaveBeenCalledWith({
            from: "end",
            limit: 20,
            query: "result",
            roles: ["assistant"],
            target: "/root/audit",
        });
        expect(result).toMatchObject({
            agents: [
                { path: "/root", session_id: "root" },
                { path: "/root/audit", session_id: "child" },
            ],
            history: expect.stringContaining("Subagent result."),
            matched_messages: 1,
            returned_messages: 1,
            stats: {
                matched: expect.objectContaining({ messages: 1 }),
                returned: expect.objectContaining({ messages: 1 }),
                total: expect.objectContaining({ messages: 1 }),
            },
            target: "/root/audit",
        });

        readAgentHistoryTool.execute({}, context, {});
        expect(read).toHaveBeenLastCalledWith({ limit: 100 });
    });
});

function stats(overrides: Partial<ReturnType<typeof zeroStats>>) {
    return { ...zeroStats(), ...overrides };
}

function zeroStats() {
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
