export function parseCodexForkTurns(
    value: string | undefined,
): { contextMode: "task" } | { contextMode: "parent"; lastNTurns?: number } {
    const forkTurns = value?.trim().toLowerCase() ?? "all";
    if (forkTurns === "none") return { contextMode: "task" };
    if (forkTurns === "all") return { contextMode: "parent" };

    const lastNTurns = Number(forkTurns);
    if (!Number.isInteger(lastNTurns) || lastNTurns <= 0) {
        throw new Error("fork_turns must be `none`, `all`, or a positive integer string.");
    }
    return { contextMode: "parent", lastNTurns };
}
