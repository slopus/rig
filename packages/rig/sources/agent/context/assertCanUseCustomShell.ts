import type { PermissionMode } from "../../permissions/index.js";

export function assertCanUseCustomShell(mode: PermissionMode, shell: string | undefined): void {
    if (shell !== undefined && mode !== "full_access") {
        throw new Error("Custom shells are available only in Full access mode.");
    }
}
