export interface ActiveFileMention {
    end: number;
    prefix: string;
    query: string;
    start: number;
}

export function findActiveFileMention(text: string, cursor: number): ActiveFileMention | undefined {
    const textBeforeCursor = text.slice(0, cursor);
    const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(textBeforeCursor);
    const match = quoted ?? /(?:^|\s)(@([^\s"]*))$/u.exec(textBeforeCursor);
    if (match?.[1] === undefined) {
        return undefined;
    }

    return {
        end: cursor,
        prefix: match[1],
        query: match[2] ?? "",
        start: cursor - match[1].length,
    };
}
