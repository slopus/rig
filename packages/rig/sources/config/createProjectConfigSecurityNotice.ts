import type { PartialRigConfig } from "./types.js";

export function createProjectConfigSecurityNotice(config: PartialRigConfig): string | undefined {
    const permission = config.defaults?.permissionMode !== undefined;
    const docker = config.docker !== undefined;
    if (!permission && !docker) return undefined;

    if (permission && docker) {
        return "This project's rig.toml requested a permission mode and Docker environment. Rig applied the other project preferences but kept execution settings under your machine-level control.";
    }
    return permission
        ? "This project's rig.toml requested a permission mode. Rig applied the other project preferences but kept your user-level permission choice."
        : "This project's rig.toml requested a Docker environment. Rig applied the other project preferences but kept container execution under your machine-level control.";
}
