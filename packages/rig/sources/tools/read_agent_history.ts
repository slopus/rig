import { Type } from "@sinclair/typebox";

import { defineTool } from "../agent/types.js";
import type { ChatHistoryStats } from "../agent/summarizeChatHistory.js";
import { formatChatHistoryPage } from "./formatChatHistoryPage.js";

const historyStatsSchema = Type.Object({
    assistant_messages: Type.Integer(),
    messages: Type.Integer(),
    text_characters: Type.Integer(),
    thinking_blocks: Type.Integer(),
    tool_calls: Type.Integer(),
    tool_results: Type.Integer(),
    user_messages: Type.Integer(),
});

export const readAgentHistoryTool = defineTool({
    name: "read_agent_history",
    label: "Read agent history",
    description:
        "Read or search Rig's durable low-level inference history for the current agent or another agent in this session tree. Use it to investigate prior requests, decisions, reasoning, tool activity, and subagent work after a model change or whenever earlier context matters. This is not a user-facing chat export. Search examines full stored messages, but each response is simplified and capped at 80,000 characters: provider-hidden reasoning is unavailable, only exposed thinking is readable, tool calls are summarized, tool outputs are truncated, and images are represented only by metadata. A requested message limit may therefore return fewer messages; continue with next_cursor or previous_cursor.",
    arguments: Type.Object({
        cursor: Type.Optional(
            Type.Integer({
                description:
                    "Zero-based original transcript position. Use a returned previous_cursor or next_cursor to navigate. Cannot be combined with from.",
                minimum: 0,
            }),
        ),
        from: Type.Optional(
            Type.Union([Type.Literal("start"), Type.Literal("end")], {
                description:
                    "Read the first or last matching page. Results are always chronological. Cannot be combined with cursor.",
            }),
        ),
        include_tools: Type.Optional(
            Type.Boolean({
                description:
                    "Include simplified tool calls and truncated tool results. Defaults to true. This does not change what query searches.",
            }),
        ),
        limit: Type.Optional(
            Type.Integer({
                description:
                    "Maximum matching messages to select before the 80,000-character response cap is applied. Defaults to 100 and cannot exceed 500. Large messages may return fewer; use the returned cursors to continue.",
                maximum: 500,
                minimum: 1,
            }),
        ),
        query: Type.Optional(
            Type.String({
                description:
                    "Case-insensitive text search across full stored conversation, thinking, tool names, arguments, and outputs.",
                minLength: 1,
            }),
        ),
        roles: Type.Optional(
            Type.Array(
                Type.Union([
                    Type.Literal("user"),
                    Type.Literal("assistant"),
                    Type.Literal("system"),
                ]),
                {
                    description: "Return only messages with one of these roles.",
                    minItems: 1,
                    uniqueItems: true,
                },
            ),
        ),
        target: Type.Optional(
            Type.String({
                description:
                    "Agent task path, task name, or session ID. Omit for the current agent. Use /root for the parent.",
            }),
        ),
    }),
    returnType: Type.Object({
        agents: Type.Array(
            Type.Object({
                description: Type.Optional(Type.String()),
                message_count: Type.Integer(),
                path: Type.String(),
                session_id: Type.String(),
                status: Type.String(),
            }),
        ),
        cursor: Type.Integer(),
        history: Type.String({
            description:
                "Simplified chronological inference history, capped at 80,000 characters. It is not verbatim provider traffic and may omit or truncate tool and image details.",
        }),
        matched_messages: Type.Integer(),
        next_cursor: Type.Optional(
            Type.Integer({
                description:
                    "Stable original-transcript position for the next matching page. Omitted at the end.",
            }),
        ),
        previous_cursor: Type.Optional(
            Type.Integer({
                description:
                    "Stable original-transcript position for the preceding matching page. Omitted at the beginning.",
            }),
        ),
        returned_messages: Type.Integer({
            description:
                "Messages actually returned after filtering and the character cap; this can be lower than limit.",
        }),
        stats: Type.Object({
            matched: historyStatsSchema,
            returned: historyStatsSchema,
            total: historyStatsSchema,
        }),
        target: Type.String(),
        total_messages: Type.Integer(),
    }),
    shouldReviewInAutoMode: () => false,
    execute: (
        { cursor, from, include_tools: includeTools = true, limit = 100, query, roles, target },
        context,
    ) => {
        if (context.chatHistory === undefined) {
            throw new Error("Agent history is unavailable outside a managed Rig session.");
        }
        if (cursor !== undefined && from !== undefined) {
            throw new Error("Use either cursor or from, not both.");
        }
        const page = context.chatHistory.read({
            ...(cursor === undefined ? {} : { cursor }),
            ...(from === undefined ? {} : { from }),
            limit,
            ...(query === undefined ? {} : { query }),
            ...(roles === undefined ? {} : { roles }),
            ...(target === undefined ? {} : { target }),
        });
        const formatted = formatChatHistoryPage(page, {
            fromEnd: from === "end",
            includeTools,
        });
        const returnedCursor = page.messages[formatted.startIndex]?.position ?? page.cursor;
        const nextCursor =
            formatted.startIndex + formatted.consumedMessages < page.messages.length
                ? page.messages[formatted.startIndex + formatted.consumedMessages]?.position
                : page.nextCursor;
        const previousCursor =
            formatted.startIndex > 0 ? page.messages[0]?.position : page.previousCursor;
        return {
            agents: page.agents.map((agent) => ({
                ...(agent.description === undefined ? {} : { description: agent.description }),
                message_count: agent.messageCount,
                path: agent.path,
                session_id: agent.sessionId,
                status: agent.status,
            })),
            cursor: returnedCursor,
            history: formatted.history,
            matched_messages: page.matchedMessages,
            ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
            ...(previousCursor === undefined ? {} : { previous_cursor: previousCursor }),
            returned_messages: formatted.consumedMessages,
            stats: {
                matched: formatStats(page.matchedStats),
                returned: formatStats(formatted.stats),
                total: formatStats(page.totalStats),
            },
            target: page.agent.path,
            total_messages: page.totalMessages,
        };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) =>
        `Read ${result.returned_messages} of ${result.total_messages} messages from ${result.target}.`,
    locks: [],
});

function formatStats(stats: ChatHistoryStats) {
    return {
        assistant_messages: stats.assistantMessages,
        messages: stats.messages,
        text_characters: stats.textCharacters,
        thinking_blocks: stats.thinkingBlocks,
        tool_calls: stats.toolCalls,
        tool_results: stats.toolResults,
        user_messages: stats.userMessages,
    };
}
