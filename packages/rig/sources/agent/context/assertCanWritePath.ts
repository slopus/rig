import { isAbsolute, resolve } from "node:path";

import { isPathInsideWorkspace } from "./isPathInsideWorkspace.js";
import { isProtectedGitControlPath } from "./isProtectedGitControlPath.js";
import { resolvePotentialPath } from "./resolvePotentialPath.js";
import type { PermissionMode } from "../../permissions/index.js";

export async function assertCanWritePath(
    cwd: string,
    targetPath: string,
    mode: PermissionMode,
): Promise<void> {
    if (mode === "full_access") return;
    if (mode === "read_only") {
        throw new Error("File changes are disabled in read-only mode.");
    }

    if (!(await isPathInsideWorkspace(cwd, targetPath))) {
        throw new Error(
            `Workspace write mode cannot modify files outside the working directory: ${cwd}.`,
        );
    }

    const absoluteTarget = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
    const canonicalTarget = await resolvePotentialPath(absoluteTarget);
    if (isProtectedGitControlPath(absoluteTarget) || isProtectedGitControlPath(canonicalTarget)) {
        throw new Error(
            "Workspace write mode cannot modify Git control files without Full access.",
        );
    }
}
