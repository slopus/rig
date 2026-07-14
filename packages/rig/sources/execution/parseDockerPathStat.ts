import type { FileSystemStat } from "../agent/context/FileSystemContext.js";

const GO_MODE_DIRECTORY = 0x80000000;
const GO_MODE_SYMLINK = 0x08000000;
const GO_MODE_TYPE = 0x8f280000;

export function parseDockerPathStat(
    encodedHeader: string | readonly string[] | undefined,
): FileSystemStat {
    const encoded = Array.isArray(encodedHeader) ? encodedHeader[0] : encodedHeader;
    if (encoded === undefined) {
        throw new Error("Docker did not return filesystem metadata for the requested path.");
    }
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("mode" in parsed) ||
        typeof parsed.mode !== "number" ||
        !("mtime" in parsed) ||
        typeof parsed.mtime !== "string" ||
        !("size" in parsed) ||
        typeof parsed.size !== "number"
    ) {
        throw new Error("Docker returned invalid filesystem metadata for the requested path.");
    }
    const mtimeMs = Date.parse(parsed.mtime);
    if (!Number.isFinite(mtimeMs)) {
        throw new Error("Docker returned an invalid modification time for the requested path.");
    }
    return {
        isDirectory: (parsed.mode & GO_MODE_DIRECTORY) !== 0,
        isFile: (parsed.mode & GO_MODE_TYPE) === 0,
        isSymbolicLink: (parsed.mode & GO_MODE_SYMLINK) !== 0,
        mtimeMs,
        size: parsed.size,
    };
}
