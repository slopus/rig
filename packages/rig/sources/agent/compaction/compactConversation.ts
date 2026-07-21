import { estimateMessagesTokens } from "./estimateMessagesTokens.js";
import { requestCompactionSummary } from "./requestCompactionSummary.js";
import { resolveAutoCompactThreshold } from "./resolveAutoCompactThreshold.js";
import { resolveAutoCompactWindow } from "./resolveAutoCompactWindow.js";
import type { Message, UserMessage } from "../types.js";
import type { Context, Model, Provider, ServiceTier } from "../../providers/types.js";

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
    createProviderContext: (messages: readonly Message[]) => Promise<Context>;
    idFactory: () => string;
    now: () => number;
    reportedTokens?: number;
    force: boolean;
    preserveLatestUserMessage: boolean;
    signal?: AbortSignal;
    serviceTier?: ServiceTier;
    thinking?: string;
}): Promise<CompactConversationResult> {
    const estimatedTokensBefore = estimateMessagesTokens(options.messages);
    const autoCompactWindow = resolveAutoCompactWindow(options.model);
    const tokensBefore = Math.max(estimatedTokensBefore, options.reportedTokens ?? 0);
    if (!options.force && tokensBefore < resolveAutoCompactThreshold(options.model)) {
        return unchanged(options.messages, estimatedTokensBefore);
    }

    const systemMessages = options.messages.filter((message) => message.role === "system");
    const conversation = options.messages.filter((message) => message.role !== "system");
    const keepStart = options.preserveLatestUserMessage
        ? findRetainedStart(conversation, autoCompactWindow)
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
        context: await options.createProviderContext([...systemMessages, ...messagesToCompact]),
        provider: options.provider,
        model: options.model,
        now: options.now,
        ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
        ...(options.thinking !== undefined ? { thinking: options.thinking } : {}),
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
    // Provider usage can include tokens that our local estimator cannot see. Once the
    // provider says the context is over the policy threshold (or rejects it outright),
    // always compact an older prefix when one exists instead of trusting a low estimate.
    return keepStart === 0 && latestUserIndex > 0 ? latestUserIndex : keepStart;
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
