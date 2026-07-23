import { existsSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

export function renderClaudeSystemPrompt(
    prompt: string,
    options: { cwd: string; env: NodeJS.ProcessEnv },
): string {
    return prompt
        .replaceAll("$CLAUDE_RUNTIME_CWD", options.cwd)
        .replaceAll(
            "$CLAUDE_RUNTIME_IS_GIT_REPOSITORY",
            String(existsSync(join(options.cwd, ".git"))),
        )
        .replaceAll("$CLAUDE_RUNTIME_PLATFORM", process.platform)
        .replaceAll("$CLAUDE_RUNTIME_SHELL", options.env.SHELL ?? "")
        .replaceAll("$CLAUDE_RUNTIME_OS_VERSION", release())
        .replaceAll("$CLAUDE_RUNTIME_GIT_STATUS", "");
}
