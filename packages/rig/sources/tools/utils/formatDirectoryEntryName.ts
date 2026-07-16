import type { AgentContext } from "../../agent/index.js";
import { resolveFileSystemPath } from "../../agent/context/resolveFileSystemPath.js";

export async function formatDirectoryEntryName(
    entry: string,
    directory: string,
    context: AgentContext,
): Promise<string> {
    try {
        const stats = await context.fs.stat(
            resolveFileSystemPath(entry, directory, context.fs.home),
        );
        return stats.isDirectory ? `${entry}/` : entry;
    } catch {
        return entry;
    }
}
