import { isAbsolute, join, normalize } from "node:path";

export function resolveWorkspacePath(workspacePath: string, path: string): string {
    const relative = path.replace(/^\/+/, "");
    const normalized = normalize(relative);
    if (
        relative.length === 0 ||
        isAbsolute(normalized) ||
        normalized === ".." ||
        normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    ) {
        throw new Error(`Gym path must stay inside /workspace: ${path}`);
    }
    return join(workspacePath, normalized);
}
