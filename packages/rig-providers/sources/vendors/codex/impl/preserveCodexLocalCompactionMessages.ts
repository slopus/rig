import type { SessionMessage, SessionUserMessage } from "@/core/SessionContext.js";
import { truncateCodexText } from "@/vendors/codex/impl/truncateCodexText.js";
import { context_checkpoint_summary_prefix } from "@/vendors/codex/prompts/context_checkpoint_compaction_instructions.js";

const PRESERVED_TOKEN_LIMIT = 20_000;
const APPROXIMATE_BYTES_PER_TOKEN = 4;

/** Applies Codex's local-compaction policy used for providers without remote compaction. */
export function preserveCodexLocalCompactionMessages(
    messages: readonly SessionMessage[],
): SessionUserMessage[] {
    const candidates = messages.filter(
        (message): message is SessionUserMessage =>
            message.role === "user" &&
            !message.content.startsWith(`${context_checkpoint_summary_prefix}\n`),
    );
    const preserved: SessionUserMessage[] = [];
    let remainingTokens = PRESERVED_TOKEN_LIMIT;
    for (const message of candidates.toReversed()) {
        if (remainingTokens === 0) break;
        const tokens = Math.ceil(Buffer.byteLength(message.content) / APPROXIMATE_BYTES_PER_TOKEN);
        if (tokens <= remainingTokens) {
            preserved.unshift(structuredClone(message));
            remainingTokens -= tokens;
            continue;
        }
        preserved.unshift({
            ...structuredClone(message),
            content: truncateCodexText(message.content, remainingTokens),
        });
        break;
    }
    return preserved;
}
