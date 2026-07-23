import type { SessionMessage } from "@/core/SessionContext.js";

export function stripCodexInitialMessages(
    messages: readonly SessionMessage[],
    initialMessageSets: readonly (readonly SessionMessage[])[],
): SessionMessage[] {
    const matching = initialMessageSets
        .filter(
            (initial) =>
                initial.length > 0 &&
                messages.length >= initial.length &&
                initial.every(
                    (message, index) => JSON.stringify(message) === JSON.stringify(messages[index]),
                ),
        )
        .sort((left, right) => right.length - left.length)[0];
    return structuredClone([
        ...(matching === undefined ? messages : messages.slice(matching.length)),
    ]);
}
