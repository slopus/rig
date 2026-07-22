export interface ResolvedCodexForkTurns {
    contextMode: "parent" | "task";
    lastNTurns?: number;
}

export function resolveCodexForkTurns(value: string | undefined): ResolvedCodexForkTurns {
    const normalized = value?.trim().toLowerCase() || "all";
    if (normalized === "none") return { contextMode: "task" };
    if (normalized === "all") return { contextMode: "parent" };
    const lastNTurns = Number(normalized);
    if (!Number.isSafeInteger(lastNTurns) || lastNTurns <= 0) {
        throw new Error("fork_turns must be `none`, `all`, or a positive integer string");
    }
    return { contextMode: "parent", lastNTurns };
}
