import { posix } from "node:path";

import type { PermissionMode } from "../permissions/index.js";

export async function assertDockerWritePath(
    cwd: string,
    path: string,
    mode: PermissionMode,
    resolvePath: (target: string) => Promise<string>,
): Promise<string> {
    const target = posix.resolve(cwd, path);
    if (mode === "full_access") return target;
    if (mode === "read_only") throw new Error("File changes are disabled in read-only mode.");
    const canonicalCwd = await resolvePath(posix.resolve(cwd));
    const canonicalTarget = await resolvePath(target);
    const relative = posix.relative(canonicalCwd, canonicalTarget);
    if (relative === ".." || relative.startsWith("../")) {
        throw new Error(
            `Workspace write mode cannot modify files outside the working directory: ${cwd}.`,
        );
    }
    if (
        [target, canonicalTarget].some((candidate) =>
            candidate
                .split("/")
                .some((part) => [".git", ".gitconfig", ".gitmodules"].includes(part.toLowerCase())),
        )
    ) {
        throw new Error(
            "Workspace write mode cannot modify Git control files without Full access.",
        );
    }
    return target;
}
