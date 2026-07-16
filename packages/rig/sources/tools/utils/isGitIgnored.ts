import { relative, sep } from "node:path";

import type { GitIgnoreScope } from "./loadGitIgnoreScope.js";

export function isGitIgnored(
    path: string,
    directory: boolean,
    scopes: readonly GitIgnoreScope[],
): boolean {
    let ignored = false;
    for (const scope of scopes) {
        const relativePath = relative(scope.directory, path).split(sep).join("/");
        if (relativePath.length === 0 || relativePath.startsWith("../")) continue;
        const result = scope.matcher.test(directory ? `${relativePath}/` : relativePath);
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
    }
    return ignored;
}
