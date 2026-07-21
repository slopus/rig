import type { PermissionMode } from "../permissions/index.js";
import type { HappyPermissionModeKind } from "./types.js";

export const HAPPY_PERMISSION_MODES = [
    {
        code: "auto",
        description: "Uses the workspace sandbox and asks before actions that need full access.",
        kind: "safe-yolo",
        value: "Auto",
    },
    {
        code: "workspace_write",
        description: "Allows workspace changes while blocking shell network and outside writes.",
        kind: "default",
        value: "Workspace write",
    },
    {
        code: "read_only",
        description: "Allows inspection without workspace changes or shell network access.",
        kind: "read-only",
        value: "Read only",
    },
    {
        code: "full_access",
        description: "Removes Rig filesystem, shell, and network restrictions.",
        kind: "yolo",
        value: "Full access",
    },
] as const satisfies readonly {
    code: PermissionMode;
    description: string;
    kind: HappyPermissionModeKind;
    value: string;
}[];
