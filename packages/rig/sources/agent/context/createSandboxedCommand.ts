import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createSandboxFilesystemConfig } from "./createSandboxFilesystemConfig.js";
import { materializeSandboxConfig } from "./materializeSandboxConfig.js";
import type { PermissionMode } from "../../permissions/index.js";

const require = createRequire(import.meta.url);
let configDirectoryPromise: Promise<string> | undefined;

export interface SandboxedCommand {
    args?: readonly string[];
    command: string;
}

export async function createSandboxedCommand(options: {
    command: string;
    cwd: string;
    mode: PermissionMode;
}): Promise<SandboxedCommand> {
    if (options.mode === "full_access") return { command: options.command };

    configDirectoryPromise ??= mkdtemp(join(tmpdir(), "rig-sandbox-"));
    const configDirectory = await configDirectoryPromise;
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
    return {
        args: [cliPath, "--settings", configPath, "-c", options.command],
        command: process.execPath,
    };
}
