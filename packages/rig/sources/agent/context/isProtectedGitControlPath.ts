import { normalize, sep } from "node:path";

const protectedFileNames = new Set([".gitconfig", ".gitmodules"]);

export function isProtectedGitControlPath(targetPath: string): boolean {
    return normalize(targetPath)
        .split(sep)
        .filter(Boolean)
        .some((part) => {
            const normalizedPart = part.toLowerCase();
            return normalizedPart === ".git" || protectedFileNames.has(normalizedPart);
        });
}
