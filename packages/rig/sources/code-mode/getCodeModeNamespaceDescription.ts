export function getCodeModeNamespaceDescription(namespace: string): string {
    return namespace === "rig"
        ? "Rig's provider-neutral tools for managing agents and workflows."
        : "Tools for spawning and managing sub-agents.";
}
