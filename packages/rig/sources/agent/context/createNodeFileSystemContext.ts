import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { assertCanReadPath } from "./assertCanReadPath.js";
import { assertCanWritePath } from "./assertCanWritePath.js";
import type { FileSystemContext } from "./FileSystemContext.js";
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
    const readPathOptions = options.home === undefined ? {} : { homeDirectory: options.home };
    return {
        cwd,
        home: options.home ?? homedir(),
        async exists(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            return existsSync(target);
        },
        async mkdir(path, options) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissionMode());
            await mkdir(target, { recursive: options?.recursive ?? false });
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
        async stat(path) {
            const target = resolvePath(path);
            await assertCanReadPath(cwd, target, permissionMode(), readPathOptions);
            const stats = await stat(target);
            return {
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                isSymbolicLink: stats.isSymbolicLink(),
                size: stats.size,
                mtimeMs: stats.mtimeMs,
            };
        },
        async writeFile(path, content) {
            const target = resolvePath(path);
            await assertCanWritePath(cwd, target, permissionMode());
            await writeFile(target, content);
        },
    };
}
