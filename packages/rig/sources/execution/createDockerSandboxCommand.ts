import type { PermissionMode } from "../permissions/index.js";
import type { PreparedDockerSandbox } from "./prepareDockerSandbox.js";

export function createDockerSandboxCommand(options: {
    command: string;
    commandCwd: string;
    mode: Exclude<PermissionMode, "full_access">;
    protectedPaths?: readonly string[];
    runtime: PreparedDockerSandbox;
    shell: string;
    workspaceCwd: string;
}): string[] {
    const command = [
        options.runtime.bwrapPath,
        "--new-session",
        "--die-with-parent",
        "--unshare-net",
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
    ];
    if (options.mode !== "read_only") {
        command.push("--bind", "/tmp", "/tmp");
        command.push("--bind", options.workspaceCwd, options.workspaceCwd);
    }
    for (const name of [".git", ".agents", ".codex"])
        command.push(
            "--ro-bind-try",
            `${options.workspaceCwd}/${name}`,
            `${options.workspaceCwd}/${name}`,
        );
    for (const path of options.protectedPaths ?? []) command.push("--ro-bind", path, path);
    command.push(
        "--unshare-pid",
        "--unshare-user",
        "--bind",
        "/proc",
        "/proc",
        "--chdir",
        options.commandCwd,
        "--",
        options.shell,
        "-lc",
        options.command,
    );
    return command;
}
