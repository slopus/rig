import { isPermissionMode } from "./isPermissionMode.js";
import { INVALID_PERMISSION_MODE_MESSAGE } from "./invalidPermissionModeMessage.js";
import type { PermissionMode } from "./PermissionMode.js";

export function parsePermissionMode(value: unknown): PermissionMode {
    if (isPermissionMode(value)) return value;
    throw new Error(INVALID_PERMISSION_MODE_MESSAGE);
}
