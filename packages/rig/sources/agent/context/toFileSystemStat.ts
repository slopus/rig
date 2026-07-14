import type { FileSystemStat } from "./FileSystemContext.js";

export function toFileSystemStat(stats: {
    isFile: boolean | (() => boolean);
    isDirectory: boolean | (() => boolean);
    isSymbolicLink: boolean | (() => boolean);
    mode: number;
    size: number;
    mtime: Date;
}): FileSystemStat {
    return {
        isFile: typeof stats.isFile === "function" ? stats.isFile() : stats.isFile,
        isDirectory:
            typeof stats.isDirectory === "function" ? stats.isDirectory() : stats.isDirectory,
        isSymbolicLink:
            typeof stats.isSymbolicLink === "function"
                ? stats.isSymbolicLink()
                : stats.isSymbolicLink,
        mode: stats.mode & 0o7777,
        size: stats.size,
        mtimeMs: stats.mtime.getTime(),
    };
}
