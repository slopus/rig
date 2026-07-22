export function describeRigAgentToolAutoPermissionAction(name: string, args: unknown): string {
    if (name === "followup_task") {
        const target =
            typeof args === "object" && args !== null && "target" in args
                ? String(args.target)
                : "the selected agent";
        return `sending model-generated follow-up work to Rig agent ${JSON.stringify(target)}, which may use another provider or region`;
    }
    const spawn =
        typeof args === "object" && args !== null
            ? (args as { context?: unknown; model?: unknown; provider?: unknown })
            : {};
    const destination = [
        spawn.provider === undefined ? undefined : `provider ${JSON.stringify(spawn.provider)}`,
        spawn.model === undefined ? undefined : `model ${JSON.stringify(spawn.model)}`,
    ]
        .filter((part) => part !== undefined)
        .join(" and ");
    const context = spawn.context === "parent" ? " with parent conversation context" : "";
    return `delegating model-generated work${context}${destination === "" ? "" : ` to ${destination}`}`;
}
