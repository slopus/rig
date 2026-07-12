import type { PermissionMode } from "../../permissions/index.js";
import { createShellEnvironment } from "./createShellEnvironment.js";

export function createToolEnvironment(
    mode: PermissionMode,
    environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    const filtered = createShellEnvironment(environment);
    if (mode === "full_access" || process.platform === "win32") return filtered;
    return {
        ...filtered,
        PATH: "/opt/homebrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    };
}
