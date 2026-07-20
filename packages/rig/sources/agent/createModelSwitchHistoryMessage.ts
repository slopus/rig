import type { Model } from "../providers/types.js";
import { summarizeChatHistory } from "./summarizeChatHistory.js";
import type { Message, SystemMessage } from "./types.js";

const BEGINNING_MESSAGE_COUNT = 4;
const RECENT_MESSAGE_COUNT = 8;
const MAX_MODEL_SWITCH_HISTORY_CHARACTERS = 32_000;

export function createModelSwitchHistoryMessage(options: {
    canReadAgentHistory: boolean;
    fromModel: Model;
    fromProviderId: string;
    id: string;
    messages: readonly Message[];
    subagentCount: number;
    toModel: Model;
    toProviderId: string;
}): SystemMessage {
    const stats = summarizeChatHistory(options.messages);
    const beginning = options.messages.slice(0, BEGINNING_MESSAGE_COUNT);
    const recentStart = Math.max(
        BEGINNING_MESSAGE_COUNT,
        options.messages.length - RECENT_MESSAGE_COUNT,
    );
    const recent = options.messages.slice(recentStart);
    const prefix = [
        "<model-switch-history-context>",
        `The active model/provider configuration changed from ${options.fromModel.name} on ${options.fromProviderId} to ${options.toModel.name} on ${options.toProviderId}.`,
        options.canReadAgentHistory
            ? "Before responding, investigate the prior Rig agent history so you understand the user's request, decisions, work already performed, and relevant subagent findings. Review the bounded excerpt below, then use read_agent_history proactively whenever the excerpt is incomplete or more detail could affect your answer."
            : "Before responding, investigate the prior Rig agent history so you understand the user's request, decisions, work already performed, and relevant subagent findings. Review the bounded excerpt below carefully; additional durable history lookup is unavailable in this runtime.",
        `The excerpt${options.canReadAgentHistory ? " and tool expose" : " exposes"} Rig's durable inference-oriented transcript, not raw provider protocol traffic or hidden reasoning. Exposed thinking and conversation are prioritized; tool calls are summarized and tool outputs are truncated.`,
        `History overview: ${stats.messages} messages, ${stats.userMessages} user messages, ${stats.assistantMessages} assistant messages, ${stats.thinkingBlocks} thinking blocks, ${stats.toolCalls} tool calls, ${stats.toolResults} tool results, ${stats.textCharacters} text characters, and ${options.subagentCount} subagents.`,
    ].join("\n");
    const beginningHeader = "Beginning history excerpt:\n";
    const recentHeader = recent.length === 0 ? "" : "\nRecent history excerpt:\n";
    const closing = "\n</model-switch-history-context>";
    const excerptBudget = Math.max(
        0,
        MAX_MODEL_SWITCH_HISTORY_CHARACTERS -
            prefix.length -
            beginningHeader.length -
            recentHeader.length -
            closing.length -
            1,
    );
    const beginningBudget = recent.length === 0 ? excerptBudget : Math.floor(excerptBudget / 3);
    const beginningText = formatMessages(beginning, 0, beginningBudget, false);
    const recentText = formatMessages(
        recent,
        recentStart,
        Math.max(0, excerptBudget - beginningText.length),
        true,
    );
    return {
        blocks: [
            {
                type: "text",
                text: `${prefix}\n${beginningHeader}${beginningText}${recentHeader}${recentText}${closing}`,
            },
        ],
        id: options.id,
        role: "system",
    };
}

function formatMessages(
    messages: readonly Message[],
    start: number,
    limit: number,
    fromEnd: boolean,
): string {
    const formatted = messages.map((message, index) => formatMessage(message, start + index));
    const selected: string[] = [];
    let characters = 0;
    const indexes = fromEnd
        ? Array.from({ length: formatted.length }, (_, index) => formatted.length - index - 1)
        : formatted.map((_, index) => index);
    for (const index of indexes) {
        const separatorLength = selected.length === 0 ? 0 : 2;
        const remaining = limit - characters - separatorLength;
        if (
            remaining <= 0 ||
            (selected.length > 0 && (formatted[index]?.length ?? 0) > remaining)
        ) {
            break;
        }
        const bounded = truncate(formatted[index] ?? "", remaining);
        if (fromEnd) selected.unshift(bounded);
        else selected.push(bounded);
        characters += separatorLength + bounded.length;
    }
    return selected.join("\n\n");
}

function formatMessage(message: Message, position: number): string {
    const role = message.role === "agent" ? "ASSISTANT" : message.role.toUpperCase();
    const lines = [`${position + 1}. ${role}`];
    for (const block of message.blocks) {
        if (block.type === "text") lines.push(`Text: ${truncate(block.text, 1_500)}`);
        else if (block.type === "image") lines.push(`[Image: ${block.mediaType}]`);
        else if (block.type === "thinking") {
            lines.push(
                block.redacted === true
                    ? "Thinking: [redacted]"
                    : `Thinking: ${truncate(block.thinking, 1_500)}`,
            );
        } else if (block.type === "tool_call") {
            lines.push(`Tool call: ${block.name} ${truncateJson(block.arguments, 500)}`);
        } else {
            const output = block.rendered
                .map((rendered) =>
                    rendered.type === "text"
                        ? rendered.text
                        : `[Image output: ${rendered.mediaType}]`,
                )
                .join("\n");
            lines.push(
                `Tool result: ${block.toolName} (${block.isError === true ? "error" : "ok"})\nSummary: ${truncate(block.display, 500)}\nOutput: ${truncate(output, 1_000)}`,
            );
        }
    }
    return lines.join("\n");
}

function truncateJson(value: unknown, limit: number): string {
    try {
        return truncate(JSON.stringify(value), limit);
    } catch {
        return "[unserializable arguments]";
    }
}

function truncate(value: string, limit: number): string {
    if (value.length <= limit) return value;
    return `${value.slice(0, Math.max(0, limit - 16))}...[truncated]`;
}
