import type { ContentBlock, Message } from "../agent/types.js";

interface TranscriptEntry {
    category: "message" | "tool";
    ordinal: number;
    text: string;
    trustedUserEvidence: boolean;
}

export interface AutoPermissionTranscript {
    text: string;
    userEvidenceOmitted: boolean;
}

const MAX_ENTRY_CHARACTERS = 8_000;
const MAX_MESSAGE_CHARACTERS = 40_000;
const MAX_TOOL_CHARACTERS = 40_000;
const MAX_RECENT_UNTRUSTED_MESSAGES = 40;
export const AUTO_PERMISSION_USER_EVIDENCE_OMITTED =
    "[Auto permission review has incomplete user evidence]";

export function createAutoPermissionTranscript(
    messages: readonly Message[],
): AutoPermissionTranscript {
    const entries = collectEntries(messages);
    const selected = new Set<number>();
    let messageCharacters = selectTrustedUserEvidence(entries, selected);

    const recentMessages = entries
        .filter(
            (entry) =>
                entry.category === "message" &&
                !entry.trustedUserEvidence &&
                !selected.has(entry.ordinal),
        )
        .slice(-MAX_RECENT_UNTRUSTED_MESSAGES)
        .reverse();
    for (const entry of recentMessages) {
        if (messageCharacters + entry.text.length > MAX_MESSAGE_CHARACTERS) continue;
        selected.add(entry.ordinal);
        messageCharacters += entry.text.length;
    }

    let toolCharacters = 0;
    const recentToolEntries = entries.filter((entry) => entry.category === "tool").reverse();
    for (const entry of recentToolEntries) {
        if (toolCharacters + entry.text.length > MAX_TOOL_CHARACTERS) continue;
        selected.add(entry.ordinal);
        toolCharacters += entry.text.length;
    }

    const retained = entries
        .filter((entry) => selected.has(entry.ordinal))
        .map((entry) => `[${String(entry.ordinal + 1)}] ${entry.text}`);
    const omitted = entries.length - retained.length;
    const omittedUserEvidence = entries.some(
        (entry) => entry.trustedUserEvidence && !selected.has(entry.ordinal),
    );
    if (omitted > 0) {
        retained.push(
            `[Context note] ${String(omitted)} transcript entr${omitted === 1 ? "y was" : "ies were"} omitted to stay within the review budget.`,
        );
    }
    if (omittedUserEvidence) retained.push(AUTO_PERMISSION_USER_EVIDENCE_OMITTED);
    return {
        text: retained.join("\n\n"),
        userEvidenceOmitted: omittedUserEvidence,
    };
}

function collectEntries(messages: readonly Message[]): TranscriptEntry[] {
    const entries: TranscriptEntry[] = [];
    for (const message of messages) {
        if (message.role === "system") continue;
        if (message.role === "user") {
            if (isGeneratedConversationSummary(message.blocks)) continue;
            const text = renderContent(message.blocks, "[Image shared by user]");
            if (text.length > 0) {
                entries.push({
                    category: "message",
                    ordinal: entries.length,
                    text: truncateEntry(`User:\n${text}`),
                    trustedUserEvidence: true,
                });
            }
            continue;
        }

        for (const block of message.blocks) {
            if (block.type === "thinking") continue;
            if (block.type === "text") {
                entries.push({
                    category: "message",
                    ordinal: entries.length,
                    text: truncateEntry(`Assistant:\n${block.text}`),
                    trustedUserEvidence: false,
                });
                continue;
            }
            if (block.type === "image") {
                entries.push({
                    category: "message",
                    ordinal: entries.length,
                    text: "Assistant:\n[Image shared by assistant]",
                    trustedUserEvidence: false,
                });
                continue;
            }
            if (block.type === "tool_call") {
                entries.push({
                    category: "message",
                    ordinal: entries.length,
                    text: truncateEntry(
                        `Assistant tool call (${block.name}):\n${safeJson(block.arguments)}`,
                    ),
                    trustedUserEvidence: false,
                });
                continue;
            }

            const trustedUserEvidence = block.trustedUserEvidence !== undefined;
            const rendered = renderContent(
                block.trustedUserEvidence ?? block.rendered,
                trustedUserEvidence ? "[Image selected by user]" : "[Image returned by tool]",
            );
            entries.push({
                category: trustedUserEvidence ? "message" : "tool",
                ordinal: entries.length,
                text: truncateEntry(
                    trustedUserEvidence
                        ? `User response through ${block.toolName}:\n${rendered}`
                        : `Tool result (${block.toolName}${block.isError === true ? ", error" : ""}):\n${rendered}`,
                ),
                trustedUserEvidence,
            });
        }
    }
    return entries;
}

function isGeneratedConversationSummary(blocks: readonly ContentBlock[]): boolean {
    if (blocks.length === 0 || blocks.some((block) => block.type !== "text")) return false;
    return blocks
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("\n")
        .trimStart()
        .startsWith("<conversation_summary>");
}

function renderContent(blocks: readonly ContentBlock[], imagePlaceholder: string): string {
    return blocks
        .map((block) => (block.type === "text" ? block.text : imagePlaceholder))
        .join("\n");
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function selectTrustedUserEvidence(
    entries: readonly TranscriptEntry[],
    selected: Set<number>,
): number {
    const trusted = entries.filter((entry) => entry.trustedUserEvidence);
    const totalCharacters = trusted.reduce((total, entry) => total + entry.text.length, 0);
    if (totalCharacters <= MAX_MESSAGE_CHARACTERS) {
        for (const entry of trusted) selected.add(entry.ordinal);
        return totalCharacters;
    }

    let retainedCharacters = 0;
    const anchors = [trusted[0], trusted.at(-1)].filter(
        (entry): entry is TranscriptEntry => entry !== undefined,
    );
    for (const entry of anchors) {
        if (selected.has(entry.ordinal)) continue;
        selected.add(entry.ordinal);
        retainedCharacters += entry.text.length;
    }
    for (const entry of trusted.toReversed()) {
        if (selected.has(entry.ordinal)) continue;
        if (retainedCharacters + entry.text.length > MAX_MESSAGE_CHARACTERS) continue;
        selected.add(entry.ordinal);
        retainedCharacters += entry.text.length;
    }
    return retainedCharacters;
}

function truncateEntry(text: string): string {
    if (text.length <= MAX_ENTRY_CHARACTERS) return text;
    const marker = "\n[...entry truncated for permission review...]\n";
    const retainedPerSide = Math.floor((MAX_ENTRY_CHARACTERS - marker.length) / 2);
    return `${text.slice(0, retainedPerSide)}${marker}${text.slice(-retainedPerSide)}`;
}
