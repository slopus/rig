import { isAbsolute, join, normalize } from "node:path";

export function resolveWorkspacePath(workspacePath: string, path: string): string {
    const normalized = normalize(path);
    if (
        path.length === 0 ||
        isAbsolute(path) ||
        isAbsolute(normalized) ||
        normalized === ".." ||
        normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
        throw new Error(`Gym path must stay inside /workspace: ${path}`);
    }
    return join(workspacePath, normalized);
}
