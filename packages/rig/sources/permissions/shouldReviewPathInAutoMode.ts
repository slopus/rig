import { isAbsolute, relative } from "node:path";

import type { AgentContext } from "../agent/context/AgentContext.js";
import { createUserSkillRootPaths } from "../agent/context/createUserSkillRootPaths.js";
import { isPathInsideWorkspace } from "../agent/context/isPathInsideWorkspace.js";
import { isProtectedGitControlPath } from "../agent/context/isProtectedGitControlPath.js";
import { resolvePotentialPath } from "../agent/context/resolvePotentialPath.js";
import { resolveFileSystemPath } from "../agent/context/resolveFileSystemPath.js";

export async function shouldReviewPathInAutoMode(
    path: string,
    context: AgentContext,
    options: { write: boolean },
): Promise<boolean> {
    let resolvedPath: string;
    try {
        resolvedPath = resolveFileSystemPath(path, context.fs.cwd, context.fs.home);
    } catch {
        return true;
    }
    if (!(await isPathInsideWorkspace(context.fs.cwd, resolvedPath))) {
        if (!options.write && context.fs.home !== undefined) {
            const canonicalTarget = await resolvePotentialPath(resolvedPath);
            for (const skillRoot of createUserSkillRootPaths(context.fs.home)) {
                const canonicalRoot = await resolvePotentialPath(skillRoot);
                const pathFromRoot = relative(canonicalRoot, canonicalTarget);
                if (
                    pathFromRoot === "" ||
                    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
                ) {
                    return false;
                }
            }
        }
        return true;
    }
    if (!options.write) return false;
    return (
        isProtectedGitControlPath(resolvedPath) ||
        isProtectedGitControlPath(await resolvePotentialPath(resolvedPath))
    );
}
