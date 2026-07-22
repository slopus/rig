export function shouldReviewRigAgentToolInAutoMode(name: string, args: unknown): boolean {
    if (name === "followup_task") return true;
    if (name !== "spawn_agent" || typeof args !== "object" || args === null) return false;
    const spawn = args as { context?: unknown; model?: unknown; provider?: unknown };
    return spawn.context === "parent" || spawn.model !== undefined || spawn.provider !== undefined;
}
