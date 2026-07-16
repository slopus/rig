import { dirname, join } from "node:path";

import type { AgentContext } from "../../agent/context/AgentContext.js";
import { loadGitIgnoreScope, type GitIgnoreScope } from "./loadGitIgnoreScope.js";

export async function loadInitialGitIgnoreScopes(
    root: string,
    context: AgentContext,
): Promise<readonly GitIgnoreScope[]> {
    const ancestors = [root];
    let cursor = root;
    let gitRootIndex: number | undefined;
    while (true) {
        try {
            await context.fs.lstat(join(cursor, ".git"));
            gitRootIndex = ancestors.length - 1;
            break;
        } catch {
            // A missing or unreadable marker is not part of the searched tree.
        }
        const parent = dirname(cursor);
        if (parent === cursor) break;
        ancestors.push(parent);
        cursor = parent;
    }

    const directories =
        gitRootIndex === undefined ? [root] : ancestors.slice(0, gitRootIndex + 1).reverse();
    const scopes: GitIgnoreScope[] = [];
    for (const directory of directories) {
        const scope = await loadGitIgnoreScope(directory, context);
        if (scope !== undefined) scopes.push(scope);
    }
    return scopes;
}
