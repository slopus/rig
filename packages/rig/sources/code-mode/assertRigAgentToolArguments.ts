export function assertRigAgentToolArguments(name: string, args: unknown): void {
    if (typeof args !== "object" || args === null) return;
    if ("encrypted_message" in args || "last_n_turns" in args) {
        throw new Error(
            `rig.${name} accepts only plaintext Rig arguments; native encrypted collaboration fields cannot cross providers or regions.`,
        );
    }
}
