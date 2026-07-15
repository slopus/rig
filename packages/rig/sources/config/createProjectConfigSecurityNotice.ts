import type { PartialRigConfig } from "./types.js";

export function createProjectConfigSecurityNotice(config: PartialRigConfig): string | undefined {
    const permission = config.defaults?.permissionMode !== undefined;
    const docker = config.docker !== undefined;
    const providers = config.providers !== undefined;
    if (!permission && !docker && !providers) return undefined;

    if (providers && !permission && !docker) {
        return "This project's rig.toml requested provider availability. Rig applied the other project preferences but kept provider and native authentication choices under your machine-level control.";
    }

    if (providers && permission && docker) {
        return "This project's rig.toml requested machine-level settings. Rig applied the other project preferences but kept permissions, container execution, and provider availability under your machine-level control.";
    }

    if (providers && permission) {
        return "This project's rig.toml requested machine-level settings. Rig applied the other project preferences but kept permissions and provider availability under your machine-level control.";
    }

    if (providers && docker) {
        return "This project's rig.toml requested machine-level settings. Rig applied the other project preferences but kept container execution and provider availability under your machine-level control.";
    }

    if (permission && docker) {
        return "This project's rig.toml requested a permission mode and Docker environment. Rig applied the other project preferences but kept execution settings under your machine-level control.";
    }
    return permission
        ? "This project's rig.toml requested a permission mode. Rig applied the other project preferences but kept your user-level permission choice."
        : "This project's rig.toml requested a Docker environment. Rig applied the other project preferences but kept container execution under your machine-level control.";
}
