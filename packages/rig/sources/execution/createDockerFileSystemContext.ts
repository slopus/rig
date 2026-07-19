import { posix } from "node:path";

import type { FileSystemContext } from "../agent/context/FileSystemContext.js";
import type { PermissionContext } from "../permissions/index.js";
import { assertDockerReadPath } from "./assertDockerReadPath.js";
import { assertDockerWritePath } from "./assertDockerWritePath.js";
import type { DockerEnvironment } from "./DockerEnvironment.js";
import { formatDockerTouchTimestamp } from "./formatDockerTouchTimestamp.js";
import { isDockerNotFoundError } from "./isDockerNotFoundError.js";
import { parseDockerPathStat } from "./parseDockerPathStat.js";
import { resolveDockerPath } from "./resolveDockerPath.js";
import { runDockerExec } from "./runDockerExec.js";

const MAX_FILE_READ_BYTES = 32 * 1024 * 1024;

export function createDockerFileSystemContext(
    environment: DockerEnvironment,
    permissions: PermissionContext,
): FileSystemContext {
    const cwd = environment.config.workingDirectory;
    let canonicalCwd: Promise<string> | undefined;
    const resolvePath = (target: string) => {
        if (target !== posix.resolve(cwd)) return resolveDockerPath(environment, target);
        canonicalCwd ??= resolveDockerPath(environment, target).catch((error: unknown) => {
            canonicalCwd = undefined;
            throw error;
        });
        return canonicalCwd;
    };
    return {
        cwd,
        async chmod(path, mode) {
            const target = await assertDockerWritePath(cwd, path, permissions.mode, resolvePath);
            await successfulExec(environment, ["chmod", (mode & 0o7777).toString(8), target]);
        },
        async exists(path) {
            const target = assertDockerReadPath(cwd, path);
            const result = await runDockerExec(await environment.container(), [
                "/bin/sh",
                "-c",
                'test -e "$1" || test -L "$1"',
                "rig",
                target,
            ]);
            return result.exitCode === 0;
        },
        async lstat(path) {
            return this.stat(path);
        },
        async mkdir(path, options) {
            const target = await assertDockerWritePath(cwd, path, permissions.mode, resolvePath);
            await successfulExec(environment, [
                "mkdir",
                ...(options?.recursive === true ? ["-p"] : []),
                "--",
                target,
            ]);
        },
        async move(source, destination) {
            const sourceTarget = await assertDockerWritePath(
                cwd,
                source,
                permissions.mode,
                resolvePath,
            );
            const destinationTarget = await assertDockerWritePath(
                cwd,
                destination,
                permissions.mode,
                resolvePath,
            );
            await successfulExec(environment, ["mv", "--", sourceTarget, destinationTarget]);
        },
        async realpath(path) {
            const target = assertDockerReadPath(cwd, path);
            return resolveDockerPath(environment, target);
        },
        async readFile(path) {
            return Buffer.from(await this.readFileBuffer(path)).toString("utf8");
        },
        async readFileBuffer(path) {
            const target = assertDockerReadPath(cwd, path);
            const details = await this.stat(path);
            if (details.size > MAX_FILE_READ_BYTES) throw fileReadLimitError(target);
            const result = await runDockerExec(
                await environment.container(),
                ["cat", "--", target],
                {
                    maxOutputBytes: MAX_FILE_READ_BYTES + 1,
                },
            );
            if (result.exitCode !== 0) throw dockerCommandError("read", target, result.stderr);
            if (result.stdout.length > MAX_FILE_READ_BYTES) throw fileReadLimitError(target);
            return result.stdout;
        },
        async readdir(path) {
            const target = assertDockerReadPath(cwd, path);
            const result = await runDockerExec(await environment.container(), [
                "/bin/sh",
                "-c",
                'for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do { test -e "$entry" || test -L "$entry"; } || continue; printf "%s\\0" "${entry##*/}"; done',
                "rig",
                target,
            ]);
            if (result.exitCode !== 0) throw dockerCommandError("list", target, result.stderr);
            return result.stdout
                .toString("utf8")
                .split("\0")
                .filter((entry) => entry.length > 0);
        },
        async rm(path, options) {
            const target = await assertDockerWritePath(cwd, path, permissions.mode, resolvePath);
            await successfulExec(environment, [
                "rm",
                ...(options?.recursive === true ? ["-r"] : []),
                ...(options?.force === true ? ["-f"] : []),
                "--",
                target,
            ]);
        },
        async setModificationTime(path, mtimeMs) {
            const target = await assertDockerWritePath(cwd, path, permissions.mode, resolvePath);
            await successfulExec(environment, [
                "env",
                "TZ=UTC0",
                "touch",
                "-m",
                "-t",
                formatDockerTouchTimestamp(mtimeMs),
                "--",
                target,
            ]);
        },
        async stat(path) {
            const target = assertDockerReadPath(cwd, path);
            const container = await environment.container();
            try {
                const response = (await container.infoArchive({
                    path: target,
                })) as NodeJS.ReadableStream & {
                    destroy?: () => void;
                    headers?: Record<string, string | string[] | undefined>;
                };
                try {
                    return parseDockerPathStat(response.headers?.["x-docker-container-path-stat"]);
                } finally {
                    response.destroy?.();
                }
            } catch (error) {
                if (isDockerNotFoundError(error)) throw dockerCommandError("inspect", target);
                throw error;
            }
        },
        async writeFile(path, content) {
            const target = await assertDockerWritePath(cwd, path, permissions.mode, resolvePath);
            const parent = posix.dirname(target);
            await successfulExec(environment, ["mkdir", "-p", "--", parent]);
            await successfulExec(environment, ["/bin/sh", "-c", 'cat > "$1"', "rig", target], {
                stdin: content,
            });
        },
    };
}

function fileReadLimitError(path: string): Error {
    return new Error(`Could not read '${path}' in the Docker container because it exceeds 32 MB.`);
}

async function successfulExec(
    environment: DockerEnvironment,
    command: readonly string[],
    options: { stdin?: string | Uint8Array } = {},
) {
    const result = await runDockerExec(await environment.container(), command, options);
    if (result.exitCode !== 0)
        throw dockerCommandError("access", command.at(-1) ?? "path", result.stderr);
}

function dockerCommandError(action: string, path: string, stderr?: Buffer): Error {
    const detail = stderr?.toString("utf8").trim();
    return new Error(
        detail === undefined || detail.length === 0
            ? `Could not ${action} '${path}' in the Docker container.`
            : `Could not ${action} '${path}' in the Docker container: ${detail}`,
    );
}
