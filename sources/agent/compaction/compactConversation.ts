import { estimateMessagesTokens } from "./estimateMessagesTokens.js";
import { requestCompactionSummary } from "./requestCompactionSummary.js";
import type { Message, UserMessage } from "../types.js";
import type { Model, Provider } from "../../providers/types.js";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const AUTO_COMPACT_FRACTION = 0.85;
const RETAINED_CONTEXT_FRACTION = 0.1;

export interface CompactConversationResult {
    compacted: boolean;
    compactedMessageCount: number;
    contextMessages: readonly Message[];
    estimatedTokensAfter: number;
    estimatedTokensBefore: number;
    retainedMessageCount: number;
}

export async function compactConversation(options: {
    provider: Provider;
    model: Model;
    messages: readonly Message[];
    idFactory: () => string;
    now: () => number;
    effort?: string;
    force: boolean;
    preserveLatestUserMessage: boolean;
    signal?: AbortSignal;
}): Promise<CompactConversationResult> {
    const estimatedTokensBefore = estimateMessagesTokens(options.messages);
    const contextWindow = options.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    if (!options.force && estimatedTokensBefore < contextWindow * AUTO_COMPACT_FRACTION) {
        return unchanged(options.messages, estimatedTokensBefore);
    }

    const systemMessages = options.messages.filter((message) => message.role === "system");
    const conversation = options.messages.filter((message) => message.role !== "system");
    const keepStart = options.preserveLatestUserMessage
        ? findRetainedStart(conversation, contextWindow)
        : conversation.length;
    const messagesToCompact = conversation.slice(0, keepStart);
    const retainedMessages = conversation.slice(keepStart);

    if (
        messagesToCompact.length < 2 ||
        !messagesToCompact.some((message) => message.role === "agent")
    ) {
        return unchanged(options.messages, estimatedTokensBefore);
    }

    const summary = await requestCompactionSummary({
        provider: options.provider,
        model: options.model,
        messages: messagesToCompact,
        now: options.now,
        ...(options.effort !== undefined ? { effort: options.effort } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    const summaryMessage: UserMessage = {
        role: "user",
        id: options.idFactory(),
        blocks: [
            {
                type: "text",
                text: `<conversation_summary>\n${summary}\n</conversation_summary>`,
            },
        ],
    };
    const contextMessages = [...systemMessages, summaryMessage, ...retainedMessages];

    return {
        compacted: true,
        compactedMessageCount: messagesToCompact.length,
        contextMessages,
        estimatedTokensAfter: estimateMessagesTokens(contextMessages),
        estimatedTokensBefore,
        retainedMessageCount: retainedMessages.length,
    };
}

function findRetainedStart(messages: readonly Message[], contextWindow: number): number {
    const userIndexes = messages.flatMap((message, index) =>
        message.role === "user" ? [index] : [],
    );
    const latestUserIndex = userIndexes.at(-1);
    if (latestUserIndex === undefined) return messages.length;

    const retainedTokenTarget = Math.max(32, Math.floor(contextWindow * RETAINED_CONTEXT_FRACTION));
    let keepStart = latestUserIndex;
    for (let index = userIndexes.length - 2; index >= 0; index -= 1) {
        const candidate = userIndexes[index];
        if (candidate === undefined) continue;
        if (estimateMessagesTokens(messages.slice(candidate)) > retainedTokenTarget) break;
        keepStart = candidate;
    }
    return keepStart;
}

function unchanged(
    messages: readonly Message[],
    estimatedTokens: number,
): CompactConversationResult {
    return {
        compacted: false,
        compactedMessageCount: 0,
        contextMessages: messages,
        estimatedTokensAfter: estimatedTokens,
        estimatedTokensBefore: estimatedTokens,
        retainedMessageCount: messages.length,
    };
}
