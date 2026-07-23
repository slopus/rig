import type { SessionMessage } from "@/core/SessionContext.js";

export function getCodexContextSuffix(
    previous: readonly SessionMessage[],
    current: readonly SessionMessage[],
): SessionMessage[] | undefined {
    if (
        previous.length > current.length ||
        !previous.every(
            (message, index) =>
                JSON.stringify(clearProviderState(message)) ===
                JSON.stringify(clearProviderState(current[index])),
        )
    ) {
        return undefined;
    }
    return structuredClone(current.slice(previous.length));
}

function clearProviderState(message: SessionMessage | undefined): SessionMessage | undefined {
    if (message?.role !== "assistant") return message;
    const clone = structuredClone(message);
    delete (clone as { encryptedReasoning?: string }).encryptedReasoning;
    delete (clone as { responseItems?: readonly string[] }).responseItems;
    return clone;
}
