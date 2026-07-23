import type { SessionMessage, SessionUserMessage } from "@/core/SessionContext.js";
import { truncateCodexText } from "@/vendors/codex/impl/truncateCodexText.js";

const PRESERVED_TOKEN_LIMIT = 64_000;
const APPROXIMATE_BYTES_PER_TOKEN = 4;

export function preserveCodexCompactionMessages(
    messages: readonly SessionMessage[],
): SessionUserMessage[] {
    const candidates = messages.filter(
        (message): message is SessionUserMessage => message.role === "user",
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
