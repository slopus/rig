import { isAbsolute, relative } from "node:path";

import { createSensitiveReadPaths } from "./createSensitiveReadPaths.js";
import { isPathInsideWorkspace } from "./isPathInsideWorkspace.js";
import { resolvePotentialPath } from "./resolvePotentialPath.js";
import type { PermissionMode } from "../../permissions/index.js";

export async function assertCanReadPath(
    cwd: string,
    targetPath: string,
    mode: PermissionMode,
    options: { environment?: NodeJS.ProcessEnv; homeDirectory?: string } = {},
): Promise<void> {
    if (mode === "full_access" || (await isPathInsideWorkspace(cwd, targetPath))) return;

    const canonicalTarget = await resolvePotentialPath(targetPath);
    for (const sensitivePath of createSensitiveReadPaths(options)) {
        const canonicalSensitivePath = await resolvePotentialPath(sensitivePath);
        const pathFromSensitiveRoot = relative(canonicalSensitivePath, canonicalTarget);
        if (
            pathFromSensitiveRoot === "" ||
            (!pathFromSensitiveRoot.startsWith("..") && !isAbsolute(pathFromSensitiveRoot))
        ) {
            throw new Error(
                `Restricted permissions block reading private files outside the workspace: ${targetPath}. Select Full access only if you intend to expose this data to the model.`,
            );
        }
    }
}
