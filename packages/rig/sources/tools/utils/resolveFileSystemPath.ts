import { isAbsolute, resolve } from "node:path";

export function resolveFileSystemPath(path: string, cwd: string, home?: string): string {
    if (path === "~" || path.startsWith("~/")) {
        if (home === undefined) {
            throw new Error(
                "Invalid path: home-relative paths are unavailable in this environment.",
            );
        }
        return path === "~" ? resolve(home) : resolve(home, path.slice(2));
    }

    return isAbsolute(path) ? path : resolve(cwd, path);
}
