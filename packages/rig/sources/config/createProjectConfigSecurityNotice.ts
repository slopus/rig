import type { PartialRigConfig } from "./types.js";

export function createProjectConfigSecurityNotice(config: PartialRigConfig): string | undefined {
    if (config.defaults?.permissionMode === undefined) return undefined;

    return "This project's rig.toml requested a permission mode. Rig applied the other project preferences but kept your user-level permission choice.";
}
