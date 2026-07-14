import type { Bash } from "just-bash";

import type { FileSystemContext } from "./FileSystemContext.js";
import { toFileSystemStat } from "./toFileSystemStat.js";

export function createJustBashFileSystemContext(bash: Bash, cwd: string): FileSystemContext {
    return {
        cwd,
        async chmod(path, mode) {
            await bash.fs.chmod(path, mode);
        },
        async exists(path) {
            try {
                await bash.fs.lstat(path);
                return true;
            } catch (error) {
                if (
                    error instanceof Error &&
                    (error.message.startsWith("ENOENT:") || error.message.startsWith("ENOTDIR:"))
                ) {
                    return false;
                }
                throw error;
            }
        },
        async lstat(path) {
            return toFileSystemStat(await bash.fs.lstat(path));
        },
        async mkdir(path, mkdirOptions) {
            await bash.fs.mkdir(path, mkdirOptions);
        },
        async move(source, destination) {
            await bash.fs.mv(source, destination);
        },
        async readFile(path) {
            return bash.fs.readFile(path);
        },
        async readFileBuffer(path) {
            return bash.fs.readFileBuffer(path);
        },
        async readdir(path) {
            return bash.fs.readdir(path);
        },
        async rm(path, rmOptions) {
            await bash.fs.rm(path, rmOptions);
        },
        async setModificationTime(path, mtimeMs) {
            const time = new Date(mtimeMs);
            await bash.fs.utimes(path, time, time);
        },
        async stat(path) {
            const stats = await bash.fs.stat(path);
            return toFileSystemStat(stats);
        },
        async writeFile(path, content) {
            await bash.fs.writeFile(path, content);
        },
    };
}
