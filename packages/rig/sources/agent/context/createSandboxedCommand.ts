import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createSandboxFilesystemConfig } from "./createSandboxFilesystemConfig.js";
import { createSandboxConfigDirectoryCache } from "./createSandboxConfigDirectoryCache.js";
import { createLinuxBubblewrapCommand } from "./createLinuxBubblewrapCommand.js";
import { createMacOsSeatbeltCommand } from "./createMacOsSeatbeltCommand.js";
import { materializeSandboxConfig } from "./materializeSandboxConfig.js";
import type { PermissionMode } from "../../permissions/index.js";
import { quoteShellArgument } from "./quoteShellArgument.js";

const require = createRequire(import.meta.url);
const getConfigDirectory = createSandboxConfigDirectoryCache(() =>
    mkdtemp(join(tmpdir(), "rig-sandbox-")),
);

export interface SandboxedCommand {
    args?: readonly string[];
    command: string;
    protectedCreatePaths?: readonly string[];
}

export async function createSandboxedCommand(options: {
    command: string;
    commandCwd?: string;
    cwd: string;
    mode: PermissionMode;
    path?: string;
    shell: string;
}): Promise<SandboxedCommand> {
    if (options.mode === "full_access") return { command: options.command };
    if (process.platform === "darwin") return createMacOsSeatbeltCommand(options);
    if (process.platform === "linux") {
        return createLinuxBubblewrapCommand({
            ...options,
            commandCwd: options.commandCwd ?? options.cwd,
            mode: options.mode,
            mountProc: !(
                process.env.RIG_GYM_OUTER_ISOLATION === "docker" && existsSync("/.dockerenv")
            ),
        });
    }

    const configDirectory = await getConfigDirectory();
    const config = {
        // Gym's disposable Docker container is the outer isolation layer for nested sandbox tests.
        enableWeakerNestedSandbox:
            process.env.RIG_GYM_OUTER_ISOLATION === "docker" && existsSync("/.dockerenv"),
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: await createSandboxFilesystemConfig({
            ...options,
            sandboxConfigDirectory: configDirectory,
        }),
    };
    const configPath = await materializeSandboxConfig(configDirectory, config);

    const packageEntry = require.resolve("@anthropic-ai/sandbox-runtime");
    const cliPath = join(dirname(packageEntry), "cli.js");
    const userCommand =
        options.path === undefined
            ? options.command
            : `export PATH=${quoteShellArgument(options.path)}\n${options.command}`;
    const command =
        process.platform === "win32"
            ? options.command
            : `${quoteShellArgument(options.shell)} -lc ${quoteShellArgument(userCommand)}`;
    return {
        args: [cliPath, "--settings", configPath, "-c", command],
        command: process.execPath,
    };
}
