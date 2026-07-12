import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createSandboxFilesystemConfig } from "./createSandboxFilesystemConfig.js";
import type { PermissionMode } from "../../permissions/index.js";

const require = createRequire(import.meta.url);
let configDirectoryPromise: Promise<string> | undefined;

export async function createSandboxedCommand(options: {
    command: string;
    cwd: string;
    mode: PermissionMode;
}): Promise<string> {
    if (options.mode === "full_access") return options.command;

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
    const key = createHash("sha256")
        .update(`${options.cwd}\0${options.mode}`)
        .digest("hex")
        .slice(0, 20);
    const configPath = join(configDirectory, `${key}.json`);
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });

    const packageEntry = require.resolve("@anthropic-ai/sandbox-runtime");
    const cliPath = join(dirname(packageEntry), "cli.js");
    return [
        shellQuote(process.execPath),
        shellQuote(cliPath),
        "--settings",
        shellQuote(configPath),
        "-c",
        shellQuote(options.command),
    ].join(" ");
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
