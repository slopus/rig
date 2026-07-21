import type { AgentContext } from "../agent/index.js";

export async function resolveHappyRipgrepExecutable(context: AgentContext): Promise<string> {
    try {
        const { rgPath } = await import("@vscode/ripgrep");
        if (await context.fs.exists(rgPath)) return rgPath;
    } catch {
        // Docker and virtual contexts cannot see the host package, and optional
        // platform packages may be omitted on unsupported installations.
    }
    return "rg";
}
