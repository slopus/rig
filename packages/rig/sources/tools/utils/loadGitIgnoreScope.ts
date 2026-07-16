import { join } from "node:path";
import ignore from "ignore";

import type { AgentContext } from "../../agent/context/AgentContext.js";

export interface GitIgnoreScope {
    directory: string;
    matcher: ReturnType<typeof ignore>;
}

export async function loadGitIgnoreScope(
    directory: string,
    context: AgentContext,
): Promise<GitIgnoreScope | undefined> {
    try {
        const contents = await context.fs.readFile(join(directory, ".gitignore"));
        return { directory, matcher: ignore().add(contents) };
    } catch {
        return undefined;
    }
}
