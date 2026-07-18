import type { AgentContext } from "../agent/context/AgentContext.js";
import { isProtectedGitControlPath } from "../agent/context/isProtectedGitControlPath.js";
import { resolveFileSystemPath } from "../agent/context/resolveFileSystemPath.js";
import { quoteVisibleExact } from "./quoteVisibleExact.js";

export function describeFileAutoPermissionAction(
    path: string,
    context: AgentContext,
    operation: string,
): string {
    let resolvedPath = path;
    try {
        resolvedPath = resolveFileSystemPath(path, context.fs.cwd, context.fs.home);
    } catch {
        // Preserve malformed input so the approval prompt still shows the proposed path.
    }
    const access = isProtectedGitControlPath(resolvedPath)
        ? "protected Git control path inside the workspace"
        : "unrestricted filesystem access outside the workspace sandbox";
    return `${operation} ${quoteVisibleExact(resolvedPath)}. Access: ${access}`;
}
