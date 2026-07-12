import type { PermissionMode } from "./PermissionMode.js";

const PERMISSION_RANK: Readonly<Record<PermissionMode, number>> = {
    auto: 2,
    full_access: 3,
    read_only: 0,
    workspace_write: 1,
};

export function isPermissionReduction(from: PermissionMode, to: PermissionMode): boolean {
    return PERMISSION_RANK[to] < PERMISSION_RANK[from];
}
