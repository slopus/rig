import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PermissionMode } from "../../permissions/index.js";
import { MACOS_SEATBELT_BASE_POLICY } from "./macOsSeatbeltBasePolicy.js";
import { quoteShellArgument } from "./quoteShellArgument.js";
import { resolvePotentialPath } from "./resolvePotentialPath.js";

const MACOS_SEATBELT_EXECUTABLE = "/usr/bin/sandbox-exec";
const PROTECTED_WORKSPACE_NAMES = [".git", ".agents", ".codex"] as const;

export async function createMacOsSeatbeltCommand(options: {
    command: string;
    cwd: string;
    environment?: NodeJS.ProcessEnv;
    mode: PermissionMode;
    path?: string;
    shell: string;
}): Promise<{ args: readonly string[]; command: string }> {
    const environment = options.environment ?? process.env;
    const temporaryDirectory = tmpdir();
    const writableCandidates =
        options.mode === "read_only" ? [] : [options.cwd, temporaryDirectory, "/tmp"];
    const writableRoots = [
        ...new Set(await Promise.all(writableCandidates.map(resolvePotentialPath))),
    ];
    const protectedCandidates = [
        ...PROTECTED_WORKSPACE_NAMES.map((name) => join(options.cwd, name)),
        join(temporaryDirectory, `rig-${process.getuid?.() ?? 0}`),
        environment.RIG_SERVER_DIRECTORY,
        environment.RIG_SERVER_SOCKET_PATH,
        environment.RIG_SERVER_TOKEN_PATH,
    ].filter((path): path is string => typeof path === "string" && path.length > 0);
    const protectedPaths = [
        ...new Set([
            ...protectedCandidates,
            ...(await Promise.all(protectedCandidates.map(resolvePotentialPath))),
        ]),
    ];
    const definitions: string[] = [];
    const writableRules = writableRoots.map((root, index) => {
        const key = `WRITABLE_ROOT_${String(index)}`;
        definitions.push(`-D${key}=${root}`);
        return `  (subpath (param "${key}"))`;
    });
    const protectedRules = protectedPaths.map((path, index) => {
        const key = `PROTECTED_WRITE_${String(index)}`;
        definitions.push(`-D${key}=${path}`);
        return `(deny file-write*
  (literal (param "${key}"))
  (subpath (param "${key}")))`;
    });
    const fileWritePolicy =
        writableRules.length === 0 ? "" : `(allow file-write*\n${writableRules.join("\n")}\n)`;
    const policy = [
        MACOS_SEATBELT_BASE_POLICY,
        "; allow read-only file operations across the host, matching Codex workspace-write",
        "(allow file-read*)",
        fileWritePolicy,
        ...protectedRules,
    ]
        .filter((section) => section.length > 0)
        .join("\n");
    const userCommand =
        options.path === undefined
            ? options.command
            : `export PATH=${quoteShellArgument(options.path)}\n${options.command}`;

    return {
        args: ["-p", policy, ...definitions, "--", options.shell, "-lc", userCommand],
        command: MACOS_SEATBELT_EXECUTABLE,
    };
}
