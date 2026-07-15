import type { SessionEvent } from "../protocol/index.js";
import type { PersistedSessionMessage } from "./InMemorySession.js";

const MAX_TURNS = 6;
const MAX_BLOCK_CHARS = 2_000;
const MAX_TRANSCRIPT_CHARS = 12_000;

export function createSessionMetadataTranscript(
    messages: readonly PersistedSessionMessage[],
    events: readonly SessionEvent[],
): string | undefined {
    const notificationIds = new Set<string>();
    for (const event of events) {
        if (event.type === "message_submitted" && event.data.source === "notification") {
            notificationIds.add(event.data.message.id);
        }
    }
    const realUsers = messages.filter(
        (entry) =>
            !entry.isPartial &&
            entry.message.role === "user" &&
            !notificationIds.has(entry.message.id) &&
            visibleText(entry.message.blocks) !== undefined,
    );
    const selectedUsers = realUsers.slice(-MAX_TURNS);
    if (selectedUsers.length === 0) return undefined;

    const lines: string[] = [];
    for (const user of selectedUsers) {
        const userText = visibleText(user.message.blocks);
        if (userText === undefined) continue;
        lines.push(`User: ${truncate(userText)}`);
        if (user.runId === undefined) continue;

        const runMessages = messages.filter(
            (entry) => entry.runId === user.runId && entry.message.role === "agent",
        );
        const assistant = [...runMessages]
            .reverse()
            .find((entry) => finalVisibleText(entry.message.blocks) !== undefined);
        if (assistant !== undefined) {
            const assistantText = finalVisibleText(assistant.message.blocks);
            if (assistantText !== undefined) {
                lines.push(
                    assistant.isPartial
                        ? `Assistant [persisted partial response from interrupted turn]: ${truncate(assistantText)}`
                        : `Assistant: ${truncate(assistantText)}`,
                );
            }
        }
    }

    const transcript = lines.join("\n");
    return transcript.length <= MAX_TRANSCRIPT_CHARS
        ? transcript
        : transcript.slice(transcript.length - MAX_TRANSCRIPT_CHARS);
}

function finalVisibleText(blocks: readonly { type: string; text?: string }[]): string | undefined {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index];
        if (block?.type === "text" && typeof block.text === "string") {
            const text = normalize(block.text);
            if (text.length > 0) return text;
        }
    }
    return undefined;
}

function visibleText(blocks: readonly { type: string; text?: string }[]): string | undefined {
    const text = blocks
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n");
    const normalized = normalize(text);
    return normalized.length === 0 ? undefined : normalized;
}

function normalize(text: string): string {
    return text
        .replace(/[\r\t]+/gu, " ")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}

function truncate(text: string): string {
    return text.length <= MAX_BLOCK_CHARS ? text : `${text.slice(0, MAX_BLOCK_CHARS - 1)}…`;
}
