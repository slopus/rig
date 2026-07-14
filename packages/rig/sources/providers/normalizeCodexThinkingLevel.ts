export function normalizeCodexThinkingLevel(level: string): string {
    return level === "ultra" ? "max" : level;
}
