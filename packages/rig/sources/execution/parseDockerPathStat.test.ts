import { describe, expect, it } from "vitest";

import { parseDockerPathStat } from "./parseDockerPathStat.js";

describe("parseDockerPathStat", () => {
    it.each([
        ["file", 0o644, 0o644, { isDirectory: false, isFile: true, isSymbolicLink: false }],
        [
            "directory",
            0x80000000 | 0o755,
            0o755,
            { isDirectory: true, isFile: false, isSymbolicLink: false },
        ],
        [
            "symbolic link",
            0x08000000 | 0o777,
            0o777,
            { isDirectory: false, isFile: false, isSymbolicLink: true },
        ],
        [
            "setuid file",
            0x00800000 | 0o755,
            0o4755,
            { isDirectory: false, isFile: true, isSymbolicLink: false },
        ],
        [
            "setgid file",
            0x00400000 | 0o755,
            0o2755,
            { isDirectory: false, isFile: true, isSymbolicLink: false },
        ],
        [
            "sticky directory",
            0x80000000 | 0x00100000 | 0o755,
            0o1755,
            { isDirectory: true, isFile: false, isSymbolicLink: false },
        ],
    ])("parses Docker metadata for a %s", (_type, mode, expectedMode, expected) => {
        const header = Buffer.from(
            JSON.stringify({ mode, mtime: "2026-07-13T12:34:56.789Z", size: 42 }),
        ).toString("base64");

        expect(parseDockerPathStat(header)).toEqual({
            ...expected,
            mode: expectedMode,
            mtimeMs: Date.parse("2026-07-13T12:34:56.789Z"),
            size: 42,
        });
    });

    it("rejects a missing metadata header", () => {
        expect(() => parseDockerPathStat(undefined)).toThrow(
            "Docker did not return filesystem metadata",
        );
    });
});
