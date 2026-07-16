import {
    chmod,
    lstat,
    mkdir,
    readFile,
    readdir,
    realpath,
    rename,
    rm,
    stat,
    utimes,
    writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { assertCanReadPath } from "./assertCanReadPath.js";
import { assertCanWritePath } from "./assertCanWritePath.js";
import { createUserSkillRootPaths } from "./createUserSkillRootPaths.js";
import type { FileSystemContext } from "./FileSystemContext.js";
import { toFileSystemStat } from "./toFileSystemStat.js";
import type { PermissionMode } from "../../permissions/index.js";

export interface CreateNodeFileSystemContextOptions {
    home?: string;
    permissionMode?: () => PermissionMode;
}

export function createNodeFileSystemContext(
    cwd: string,
    options: CreateNodeFileSystemContextOptions = {},
): FileSystemContext {
    const permissionMode = options.permissionMode ?? (() => "full_access" as const);
    const resolvePath = (path: string) => (isAbsolute(path) ? path : resolve(cwd, path));
    const home = options.home ?? homedir();
    const readPathOptions = {
        allowedPaths: createUserSkillRootPaths(home),
        homeDirectory: home,
    };
    return {
        cwd,
        home,
        async chmod(path, mode) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissionMode());
            await chmod(target, mode);
        },
        async exists(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            try {
                await lstat(target);
                return true;
            } catch (error) {
                if (
                    error instanceof Error &&
                    "code" in error &&
                    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
                ) {
                    return false;
                }
                throw error;
            }
        },
        async lstat(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            return toFileSystemStat(await lstat(target));
        },
        async mkdir(path, options) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissionMode());
            await mkdir(target, { recursive: options?.recursive ?? false });
        },
        async move(source, destination) {
            const sourceTarget = resolvePath(source);
            const destinationTarget = resolvePath(destination);
            await assertCanWritePath(cwd, sourceTarget, permissionMode());
            await assertCanWritePath(cwd, destinationTarget, permissionMode());
            await rename(sourceTarget, destinationTarget);
        },
        async realpath(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            return realpath(target);
        },
        async readFile(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            return readFile(target, "utf8");
        },
        async readFileBuffer(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            return readFile(target);
        },
        async readdir(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            return readdir(target);
        },
        async rm(path, options) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissionMode());
            await rm(target, {
                recursive: options?.recursive ?? false,
                force: options?.force ?? false,
            });
        },
        async setModificationTime(path, mtimeMs) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissionMode());
            const time = new Date(mtimeMs);
            await utimes(target, time, time);
        },
        async stat(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            return toFileSystemStat(await stat(target));
        },
        async writeFile(path, content) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissionMode());
            await writeFile(target, content);
        },
    };
}
