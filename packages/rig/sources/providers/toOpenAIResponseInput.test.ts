import { describe, expect, it } from "vitest";

import { toOpenAIResponseInput } from "./toOpenAIResponseInput.js";
import type { Context } from "./types.js";

describe("toOpenAIResponseInput", () => {
    it("forwards encrypted collaboration payloads as Codex agent messages", () => {
        const context: Context = {
            messages: [
                {
                    role: "user",
                    content: [],
                    encryptedAgentMessage: {
                        author: "/root",
                        recipient: "/root/audit",
                        header: "Message Type: NEW_TASK\nTask name: /root/audit\nSender: /root\nPayload:\n",
                        encryptedContent: "opaque-encrypted-task",
                    },
                    timestamp: 1,
                },
            ],
        };

        expect(toOpenAIResponseInput(context)).toEqual([
            {
                type: "agent_message",
                author: "/root",
                recipient: "/root/audit",
                content: [
                    {
                        type: "input_text",
                        text: "Message Type: NEW_TASK\nTask name: /root/audit\nSender: /root\nPayload:\n",
                    },
                    {
                        type: "encrypted_content",
                        encrypted_content: "opaque-encrypted-task",
                    },
                ],
            },
        ]);
    });

    it("continues custom tool calls with custom outputs", () => {
        const context: Context = {
            messages: [
                { role: "user", content: "Run it.", timestamp: 1 },
                {
                    role: "assistant",
                    api: "openai-responses",
                    provider: "codex",
                    model: "openai/gpt-5.6-sol",
                    content: [
                        {
                            type: "toolCall",
                            kind: "custom",
                            id: "call_exec|ctc_exec",
                            name: "exec",
                            arguments: { input: "text('ok')" },
                        },
                    ],
                    stopReason: "toolUse",
                    timestamp: 2,
                    usage: zeroUsage(),
                },
                {
                    role: "toolResult",
                    toolCallId: "call_exec|ctc_exec",
                    toolName: "exec",
                    content: [{ type: "text", text: "Script completed" }],
                    isError: false,
                    timestamp: 3,
                },
            ],
        };

        expect(toOpenAIResponseInput(context)).toEqual([
            { role: "user", content: "Run it." },
            {
                type: "custom_tool_call",
                call_id: "call_exec",
                id: "ctc_exec",
                name: "exec",
                input: "text('ok')",
            },
            {
                type: "custom_tool_call_output",
                call_id: "call_exec",
                output: "Script completed",
            },
        ]);
    });

    it("preserves a function call namespace in continuation input", () => {
        const context: Context = {
            messages: [
                {
                    role: "assistant",
                    api: "openai-responses",
                    provider: "codex",
                    model: "openai/gpt-5.6-sol",
                    content: [
                        {
                            type: "toolCall",
                            id: "call_spawn|fc_spawn",
                            name: "spawn_agent",
                            namespace: "collaboration",
                            arguments: { task_name: "audit" },
                        },
                    ],
                    stopReason: "toolUse",
                    timestamp: 1,
                    usage: zeroUsage(),
                },
                {
                    role: "toolResult",
                    toolCallId: "call_spawn|fc_spawn",
                    toolName: "spawn_agent",
                    content: [{ type: "text", text: "started" }],
                    isError: false,
                    timestamp: 2,
                },
            ],
        };

        expect(toOpenAIResponseInput(context)).toEqual([
            {
                type: "function_call",
                call_id: "call_spawn",
                id: "fc_spawn",
                name: "spawn_agent",
                namespace: "collaboration",
                arguments: JSON.stringify({ task_name: "audit" }),
            },
            {
                type: "function_call_output",
                call_id: "call_spawn",
                output: "started",
            },
        ]);
    });
});

function zeroUsage() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}
