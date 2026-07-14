import { posix } from "node:path";

import type { PermissionMode } from "../permissions/index.js";

const PRIVATE_PATH_SEGMENTS = [
    "/.aws/",
    "/.azure/",
    "/.bash_history/",
    "/.claude/",
    "/.codex/",
    "/.config/1password/",
    "/.config/gcloud/",
    "/.config/gh/",
    "/.config/glab-cli/",
    "/.config/op/",
    "/.docker/",
    "/.env/",
    "/.git-credentials/",
    "/.gnupg/",
    "/.kube/",
    "/.local/share/keyrings/",
    "/.netrc/",
    "/.node_repl_history/",
    "/.npmrc/",
    "/.password-store/",
    "/.psql_history/",
    "/.pypirc/",
    "/.python_history/",
    "/.ssh/",
    "/.zsh_history/",
    "/library/keychains/",
];

export async function assertDockerReadPath(
    cwd: string,
    path: string,
    mode: PermissionMode,
    resolvePath: (target: string) => Promise<string>,
): Promise<string> {
    const target = posix.resolve(cwd, path);
    if (mode === "full_access") return target;
    const [canonicalCwd, canonicalTarget] = await Promise.all([
        resolvePath(posix.resolve(cwd)),
        resolvePath(target),
    ]);
    if (isInside(canonicalCwd, canonicalTarget)) return target;
    const normalized = `${canonicalTarget}/`.toLowerCase();
    if (PRIVATE_PATH_SEGMENTS.some((segment) => normalized.includes(segment))) {
        throw new Error(
            `Restricted permissions block reading private files outside the workspace: ${path}. Select Full access only if you intend to expose this data to the model.`,
        );
    }
    return target;
}

function isInside(cwd: string, target: string): boolean {
    const relative = posix.relative(posix.resolve(cwd), target);
    return relative === "" || (!relative.startsWith("../") && relative !== "..");
}
