export function orderMessagesByEventSequence<T extends { messageId: string }>(
    existing: readonly T[],
    additions: readonly T[],
    sequenceByMessageId: ReadonlyMap<string, number>,
): T[] {
    const seen = new Set<string>();
    const combined = [...existing, ...additions].filter((entry) => {
        if (seen.has(entry.messageId)) return false;
        seen.add(entry.messageId);
        return true;
    });
    const orderedKnown = combined
        .filter((entry) => sequenceByMessageId.has(entry.messageId))
        .sort(
            (left, right) =>
                (sequenceByMessageId.get(left.messageId) ?? 0) -
                (sequenceByMessageId.get(right.messageId) ?? 0),
        );
    let knownIndex = 0;
    return combined.map((entry) => {
        if (!sequenceByMessageId.has(entry.messageId)) return entry;
        const ordered = orderedKnown[knownIndex];
        knownIndex += 1;
        return ordered ?? entry;
    });
}
