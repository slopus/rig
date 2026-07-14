export function seekPatchSequence(
    lines: readonly string[],
    pattern: readonly string[],
    start: number,
    endOfFile = false,
): number {
    if (pattern.length === 0) return Math.min(start, lines.length);
    if (pattern.length > lines.length) return -1;

    const lastStart = lines.length - pattern.length;
    const searchStart = endOfFile ? lastStart : start;
    const matches = (index: number, normalize: (value: string) => string) => {
        for (let offset = 0; offset < pattern.length; offset += 1) {
            if (normalize(lines[index + offset] ?? "") !== normalize(pattern[offset] ?? "")) {
                return false;
            }
        }
        return true;
    };
    const identity = (value: string) => value;
    const trimEnd = (value: string) => value.trimEnd();
    const trim = (value: string) => value.trim();
    const normalizePunctuation = (value: string) =>
        value
            .trim()
            .replace(/[‐‑‒–—―−]/gu, "-")
            .replace(/[‘’‚‛]/gu, "'")
            .replace(/[“”„‟]/gu, '"')
            .replace(/[            　]/gu, " ");

    for (const normalize of [identity, trimEnd, trim, normalizePunctuation]) {
        for (let index = searchStart; index <= lastStart; index += 1) {
            if (matches(index, normalize)) return index;
        }
    }
    return -1;
}
