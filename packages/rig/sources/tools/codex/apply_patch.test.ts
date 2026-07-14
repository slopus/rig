import {
    chmod,
    link,
    mkdir,
    mkdtemp,
    readFile,
    readlink,
    rm,
    stat,
    symlink,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createNodeFileSystemContext } from "../../agent/context/createNodeFileSystemContext.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { applyPatchText } from "../utils/index.js";
import { codexApplyPatchTool } from "./apply_patch.js";

describe("codex apply_patch tool", () => {
    it("applies Codex-style add-file patches", async () => {
        const harness = createJustBashToolHarness();
        const args = {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Add File: created.txt",
                "+hello",
                "+world",
                "*** End Patch",
            ].join("\n"),
        };

        const result = await harness.runTool(codexApplyPatchTool, args);

        expect(result.text).toBe("Success. Updated the following files:\nA created.txt");
        expect(result.files).toEqual([
            {
                hunks: [
                    {
                        lines: [
                            { kind: "add", text: "hello" },
                            { kind: "add", text: "world" },
                        ],
                        newStart: 1,
                        oldStart: 0,
                    },
                ],
                kind: "add",
                path: "created.txt",
            },
        ]);
        expect(codexApplyPatchTool.toLLM(result)).toEqual([
            { text: "Success. Updated the following files:\nA created.txt", type: "text" },
        ]);
        expect(codexApplyPatchTool.toUI(result, args)).toBe("Applied patch");
        expect(codexApplyPatchTool.toPresentation?.(result, args)).toEqual({
            files: result.files,
            type: "file_diff",
        });
        expect(await harness.readFile("/workspace/created.txt")).toBe("hello\nworld");
    });

    it("returns exact update hunks with old and new line numbers", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/src/greet.ts": [
                    "const ready = true;",
                    "",
                    "export function greet(name: string) {",
                    "  return `goodbye, ${name}`;",
                    "}",
                ].join("\n"),
            },
        });

        const result = await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Update File: src/greet.ts",
                "@@",
                " const ready = true;",
                '+const language = "en";',
                "@@",
                " export function greet(name: string) {",
                "-  return `goodbye, ${name}`;",
                "+  return `hello, ${name}`;",
                " }",
                "*** End Patch",
            ].join("\n"),
        });

        expect(result.files).toEqual([
            {
                hunks: [
                    {
                        lines: [
                            { kind: "context", text: "const ready = true;" },
                            { kind: "add", text: 'const language = "en";' },
                        ],
                        newStart: 1,
                        oldStart: 1,
                    },
                    {
                        lines: [
                            {
                                kind: "context",
                                text: "export function greet(name: string) {",
                            },
                            { kind: "delete", text: "  return `goodbye, ${name}`;" },
                            { kind: "add", text: "  return `hello, ${name}`;" },
                            { kind: "context", text: "}" },
                        ],
                        newStart: 4,
                        oldStart: 3,
                    },
                ],
                kind: "update",
                path: "src/greet.ts",
            },
        ]);
        expect(await harness.readFile("/workspace/src/greet.ts")).toBe(
            [
                "const ready = true;",
                'const language = "en";',
                "",
                "export function greet(name: string) {",
                "  return `hello, ${name}`;",
                "}",
            ].join("\n"),
        );
    });

    it("returns exact deleted-file lines", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/obsolete.ts": "const obsolete = true;\nexport { obsolete };\n" },
        });

        const result = await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: ["*** Begin Patch", "*** Delete File: obsolete.ts", "*** End Patch"].join("\n"),
        });

        expect(result.files).toEqual([
            {
                hunks: [
                    {
                        lines: [
                            { kind: "delete", text: "const obsolete = true;" },
                            { kind: "delete", text: "export { obsolete };" },
                        ],
                        newStart: 0,
                        oldStart: 1,
                    },
                ],
                kind: "delete",
                path: "obsolete.ts",
            },
        ]);
        await expect(harness.readFile("/workspace/obsolete.ts")).rejects.toThrow();
    });

    it("bounds a huge deleted-file presentation while preserving exact totals", async () => {
        const lineCount = 750;
        const longLine = "x".repeat(2_100);
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/generated.txt": `${Array(lineCount).fill(longLine).join("\n")}\n`,
            },
        });

        const result = await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: ["*** Begin Patch", "*** Delete File: generated.txt", "*** End Patch"].join(
                "\n",
            ),
        });

        expect(result.files).toHaveLength(1);
        expect(result.files[0]).toMatchObject({
            added: 0,
            deleted: lineCount,
            omittedLines: 250,
            path: "generated.txt",
        });
        const retainedLines = result.files[0]?.hunks.flatMap((hunk) => hunk.lines) ?? [];
        expect(retainedLines).toHaveLength(500);
        expect(retainedLines.every((line) => line.text.length === 2_000)).toBe(true);

        const presentation = codexApplyPatchTool.toPresentation?.(result, {
            workdir: "/workspace",
            patch: "unused",
        });
        expect(JSON.stringify(presentation).length).toBeLessThan(1_100_000);
        expect(JSON.stringify(codexApplyPatchTool.toLLM(result))).not.toContain(longLine);
        await expect(harness.readFile("/workspace/generated.txt")).rejects.toThrow();
    });

    it("persists at most twenty file diffs and reports the exact omitted file count", async () => {
        const patchLines = ["*** Begin Patch"];
        for (let index = 0; index < 25; index++) {
            patchLines.push(`*** Add File: generated-${index}.txt`, `+value ${index}`);
        }
        patchLines.push("*** End Patch");
        const harness = createJustBashToolHarness();

        const result = await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: patchLines.join("\n"),
        });

        expect(result.files).toHaveLength(20);
        expect(result.omittedFiles).toBe(5);
        expect(
            codexApplyPatchTool.toPresentation?.(result, {
                patch: "unused",
                workdir: "/workspace",
            }),
        ).toMatchObject({
            files: result.files,
            omittedFiles: 5,
            type: "file_diff",
        });
    });

    it("represents a moved and updated file as a deletion plus an addition", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/old.ts": "const value = 1;\n" },
        });

        const result = await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Update File: old.ts",
                "*** Move to: new.ts",
                "@@",
                "-const value = 1;",
                "+const value = 2;",
                "*** End Patch",
            ].join("\n"),
        });

        expect(result.files).toEqual([
            {
                hunks: [
                    {
                        lines: [{ kind: "delete", text: "const value = 1;" }],
                        newStart: 0,
                        oldStart: 1,
                    },
                ],
                kind: "delete",
                path: "old.ts",
            },
            {
                hunks: [
                    {
                        lines: [{ kind: "add", text: "const value = 2;" }],
                        newStart: 1,
                        oldStart: 0,
                    },
                ],
                kind: "add",
                path: "new.ts",
            },
        ]);
        await expect(harness.readFile("/workspace/old.ts")).rejects.toThrow();
        expect(await harness.readFile("/workspace/new.ts")).toBe("const value = 2;\n");
    });

    it("moves a file without requiring a content edit", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/old.ts": { content: "const value = 1;\n", mode: 0o755 },
            },
        });

        const result = await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Update File: old.ts",
                "*** Move to: nested/new.ts",
                "*** End Patch",
            ].join("\n"),
        });

        expect(result.files).toEqual([
            {
                hunks: [
                    {
                        lines: [{ kind: "delete", text: "const value = 1;" }],
                        newStart: 0,
                        oldStart: 1,
                    },
                ],
                kind: "delete",
                path: "old.ts",
            },
            {
                hunks: [
                    {
                        lines: [{ kind: "add", text: "const value = 1;" }],
                        newStart: 1,
                        oldStart: 0,
                    },
                ],
                kind: "add",
                path: "nested/new.ts",
            },
        ]);
        await expect(harness.readFile("/workspace/old.ts")).rejects.toThrow();
        expect(await harness.readFile("/workspace/nested/new.ts")).toBe("const value = 1;\n");
        expect((await harness.context.fs.stat("/workspace/nested/new.ts")).mode).toBe(0o755);
    });

    it("validates every hunk before mutating any file", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/first.txt": "first before\n",
                "/workspace/second.txt": "second before\n",
            },
        });

        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Update File: first.txt",
                    "@@",
                    "-first before",
                    "+first after",
                    "*** Update File: second.txt",
                    "@@",
                    "-missing second content",
                    "+second after",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("Invalid patch: hunk did not match second.txt");

        expect(await harness.readFile("/workspace/first.txt")).toBe("first before\n");
        expect(await harness.readFile("/workspace/second.txt")).toBe("second before\n");
    });

    it("does not hide overwrites behind add or move presentations", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/existing.txt": "keep me\n",
                "/workspace/source.txt": "source\n",
                "/workspace/target.txt": "target\n",
            },
        });

        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Add File: existing.txt",
                    "+replacement",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("add file already exists: existing.txt");
        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Update File: source.txt",
                    "*** Move to: target.txt",
                    "@@",
                    "-source",
                    "+moved",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("move target already exists: target.txt");

        expect(await harness.readFile("/workspace/existing.txt")).toBe("keep me\n");
        expect(await harness.readFile("/workspace/source.txt")).toBe("source\n");
        expect(await harness.readFile("/workspace/target.txt")).toBe("target\n");
    });

    it("rolls back every file when a commit-stage write fails", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/first.txt": "first before\n",
                "/workspace/second.txt": "second before\n",
            },
        });
        const writeFile = harness.context.fs.writeFile;
        let writeCount = 0;
        const context = {
            ...harness.context,
            fs: {
                ...harness.context.fs,
                async writeFile(path: string, content: string | Uint8Array) {
                    writeCount += 1;
                    if (writeCount === 2) throw new Error("injected second write failure");
                    await writeFile(path, content);
                },
            },
        };

        await expect(
            applyPatchText(
                [
                    "*** Begin Patch",
                    "*** Update File: first.txt",
                    "@@",
                    "-first before",
                    "+first after",
                    "*** Update File: second.txt",
                    "@@",
                    "-second before",
                    "+second after",
                    "*** End Patch",
                ].join("\n"),
                "/workspace",
                context,
            ),
        ).rejects.toThrow("injected second write failure");

        expect(await harness.readFile("/workspace/first.txt")).toBe("first before\n");
        expect(await harness.readFile("/workspace/second.txt")).toBe("second before\n");
        expect(writeCount).toBe(4);
    });

    it("restores executable metadata when a later delete fails", async () => {
        const harness = createJustBashToolHarness({
            files: {
                "/workspace/run.sh": { content: "#!/bin/sh\necho ready\n", mode: 0o755 },
                "/workspace/blocked.txt": "blocked\n",
            },
        });
        const rm = harness.context.fs.rm;
        let removeCount = 0;
        const context = {
            ...harness.context,
            fs: {
                ...harness.context.fs,
                async rm(path: string, options?: { force?: boolean; recursive?: boolean }) {
                    if (options?.force !== true) {
                        removeCount += 1;
                        if (removeCount === 2) throw new Error("injected second delete failure");
                    }
                    await rm(path, options);
                },
            },
        };

        await expect(
            applyPatchText(
                [
                    "*** Begin Patch",
                    "*** Delete File: run.sh",
                    "*** Delete File: blocked.txt",
                    "*** End Patch",
                ].join("\n"),
                "/workspace",
                context,
            ),
        ).rejects.toThrow("injected second delete failure");

        expect(await harness.readFile("/workspace/run.sh")).toBe("#!/bin/sh\necho ready\n");
        expect((await harness.context.fs.stat("/workspace/run.sh")).mode).toBe(0o755);
        expect(await harness.readFile("/workspace/blocked.txt")).toBe("blocked\n");
    });

    it("restores mode and modification time on the real filesystem", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-patch-metadata-"));
        try {
            const executable = join(directory, "run.sh");
            const blocked = join(directory, "blocked.txt");
            const originalMtime = new Date("2020-01-02T03:04:05.000Z");
            await writeFile(executable, "#!/bin/sh\necho ready\n");
            await chmod(executable, 0o755);
            await utimes(executable, originalMtime, originalMtime);
            await writeFile(blocked, "blocked\n");

            const fs = createNodeFileSystemContext(directory);
            const remove = fs.rm;
            let removeCount = 0;
            const context = {
                ...createJustBashToolHarness().context,
                fs: {
                    ...fs,
                    async rm(path: string, options?: { force?: boolean; recursive?: boolean }) {
                        if (options?.force !== true) {
                            removeCount += 1;
                            if (removeCount === 2) {
                                throw new Error("injected real filesystem delete failure");
                            }
                        }
                        await remove(path, options);
                    },
                },
            };

            await expect(
                applyPatchText(
                    [
                        "*** Begin Patch",
                        "*** Delete File: run.sh",
                        "*** Delete File: blocked.txt",
                        "*** End Patch",
                    ].join("\n"),
                    directory,
                    context,
                ),
            ).rejects.toThrow("injected real filesystem delete failure");

            expect(await readFile(executable, "utf8")).toBe("#!/bin/sh\necho ready\n");
            const restored = await stat(executable);
            expect(restored.mode & 0o777).toBe(0o755);
            expect(restored.mtimeMs).toBe(originalMtime.getTime());
            expect(await readFile(blocked, "utf8")).toBe("blocked\n");
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    it("rejects symbolic links without changing the link or its target", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/target.txt": "target\n" },
        });
        await harness.bash.fs.symlink("target.txt", "/workspace/link.txt");

        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: ["*** Begin Patch", "*** Delete File: link.txt", "*** End Patch"].join("\n"),
            }),
        ).rejects.toThrow("cannot modify symbolic link");

        expect(await harness.bash.fs.readlink("/workspace/link.txt")).toBe("target.txt");
        expect(await harness.readFile("/workspace/target.txt")).toBe("target\n");
    });

    it("does not treat a dangling link as an available add or move destination", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-patch-dangling-link-"));
        try {
            const link = join(directory, "dangling.txt");
            const missingTarget = join(directory, "missing.txt");
            const source = join(directory, "source.txt");
            await symlink("missing.txt", link);
            await writeFile(source, "source\n");
            const fs = createNodeFileSystemContext(directory);
            const context = { ...createJustBashToolHarness().context, fs };

            await expect(
                applyPatchText(
                    [
                        "*** Begin Patch",
                        "*** Add File: dangling.txt",
                        "+replacement",
                        "*** End Patch",
                    ].join("\n"),
                    directory,
                    context,
                ),
            ).rejects.toThrow("add file already exists: dangling.txt");
            await expect(
                applyPatchText(
                    [
                        "*** Begin Patch",
                        "*** Update File: source.txt",
                        "*** Move to: dangling.txt",
                        "*** End Patch",
                    ].join("\n"),
                    directory,
                    context,
                ),
            ).rejects.toThrow("move target already exists: dangling.txt");

            expect(await readlink(link)).toBe("missing.txt");
            await expect(stat(missingTarget)).rejects.toMatchObject({ code: "ENOENT" });
            expect(await readFile(source, "utf8")).toBe("source\n");
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    it("recognizes dangling links in the in-memory filesystem", async () => {
        const harness = createJustBashToolHarness();
        await harness.bash.fs.symlink("missing.txt", "/workspace/dangling.txt");

        await expect(harness.context.fs.exists("/workspace/dangling.txt")).resolves.toBe(true);
        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Add File: dangling.txt",
                    "+replacement",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("add file already exists: dangling.txt");
        expect(await harness.bash.fs.readlink("/workspace/dangling.txt")).toBe("missing.txt");
    });

    it("removes newly created parent directories when an add-file write fails", async () => {
        const harness = createJustBashToolHarness();
        const context = {
            ...harness.context,
            fs: {
                ...harness.context.fs,
                async writeFile() {
                    throw new Error("injected nested add failure");
                },
            },
        };

        await expect(
            applyPatchText(
                [
                    "*** Begin Patch",
                    "*** Add File: new/deep/file.txt",
                    "+never committed",
                    "*** End Patch",
                ].join("\n"),
                "/workspace",
                context,
            ),
        ).rejects.toThrow("injected nested add failure");

        await expect(harness.context.fs.exists("/workspace/new/deep/file.txt")).resolves.toBe(
            false,
        );
        await expect(harness.context.fs.exists("/workspace/new/deep")).resolves.toBe(false);
        await expect(harness.context.fs.exists("/workspace/new")).resolves.toBe(false);
        await expect(harness.context.fs.exists("/workspace")).resolves.toBe(true);
    });

    it("rejects out-of-order hunks without mutating the file", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/order.txt": "A\nB\nC\nD\n" },
        });

        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Update File: order.txt",
                    "@@",
                    " D",
                    "+E",
                    "@@",
                    "-A",
                    "+AA",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("Invalid patch: hunk did not match order.txt");

        expect(await harness.readFile("/workspace/order.txt")).toBe("A\nB\nC\nD\n");
    });

    it("matches whole lines and never edits a substring", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/words.txt": "concatenate\n" },
        });

        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Update File: words.txt",
                    "@@",
                    "-cat",
                    "+dog",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("Invalid patch: hunk did not match words.txt");
        expect(await harness.readFile("/workspace/words.txt")).toBe("concatenate\n");
    });

    it("matches repeated contexts in forward order", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/repeated.txt": "same\nbetween\nsame\n" },
        });

        await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Update File: repeated.txt",
                "@@",
                "-same",
                "+first",
                "@@",
                "-same",
                "+second",
                "*** End Patch",
            ].join("\n"),
        });

        expect(await harness.readFile("/workspace/repeated.txt")).toBe("first\nbetween\nsecond\n");
    });

    it("appends a pure-add hunk at end of file", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/append.txt": "A\nB\n" },
        });

        const result = await harness.runTool(codexApplyPatchTool, {
            workdir: "/workspace",
            patch: [
                "*** Begin Patch",
                "*** Update File: append.txt",
                "@@",
                "+C",
                "*** End Patch",
            ].join("\n"),
        });

        expect(await harness.readFile("/workspace/append.txt")).toBe("A\nB\nC\n");
        expect(result.files[0]?.hunks[0]).toMatchObject({ newStart: 3, oldStart: 3 });
    });

    it("resolves a relative workdir inside the filesystem context", async () => {
        const harness = createJustBashToolHarness();

        await harness.runTool(codexApplyPatchTool, {
            workdir: "nested",
            patch: ["*** Begin Patch", "*** Add File: made.txt", "+inside", "*** End Patch"].join(
                "\n",
            ),
        });

        expect(await harness.readFile("/workspace/nested/made.txt")).toBe("inside");
        await expect(harness.readFile("/workspace/made.txt")).rejects.toThrow();
    });

    it("rejects invalid UTF-8 before moving or changing any bytes", async () => {
        const harness = createJustBashToolHarness();
        const original = new Uint8Array([0xff, 0x00, 0x80, 0x41]);
        await harness.bash.fs.writeFile("/workspace/binary.dat", original);

        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Update File: binary.dat",
                    "*** Move to: moved.dat",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("cannot modify non-UTF-8 file");

        expect(await harness.bash.fs.readFileBuffer("/workspace/binary.dat")).toEqual(original);
        await expect(harness.context.fs.exists("/workspace/moved.dat")).resolves.toBe(false);
    });

    it("uses a native rename for standalone moves", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-patch-native-move-"));
        try {
            const source = join(directory, "source.txt");
            const destination = join(directory, "nested", "destination.txt");
            const hardLink = join(directory, "hard-link.txt");
            await writeFile(source, "preserve identity\n");
            await link(source, hardLink);
            const before = await stat(source);
            const fs = createNodeFileSystemContext(directory);
            const context = { ...createJustBashToolHarness().context, fs };

            await applyPatchText(
                [
                    "*** Begin Patch",
                    "*** Update File: source.txt",
                    "*** Move to: nested/destination.txt",
                    "*** End Patch",
                ].join("\n"),
                directory,
                context,
            );

            const moved = await stat(destination);
            const linked = await stat(hardLink);
            expect(moved.ino).toBe(before.ino);
            expect(linked.ino).toBe(before.ino);
            expect(moved.nlink).toBe(2);
            await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    it("returns the original permission error when a protected write is rejected", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-patch-permission-"));
        try {
            const gitDirectory = join(directory, ".git");
            const config = join(gitDirectory, "config");
            await mkdir(gitDirectory);
            await writeFile(config, "before\n");
            const fs = createNodeFileSystemContext(directory, {
                permissionMode: () => "workspace_write",
            });
            const context = { ...createJustBashToolHarness().context, fs };

            await expect(
                applyPatchText(
                    [
                        "*** Begin Patch",
                        "*** Update File: .git/config",
                        "@@",
                        "-before",
                        "+after",
                        "*** End Patch",
                    ].join("\n"),
                    directory,
                    context,
                ),
            ).rejects.toThrow(
                "Workspace write mode cannot modify Git control files without Full access.",
            );
            expect(await readFile(config, "utf8")).toBe("before\n");
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });

    it("rejects empty and no-op patches instead of hiding their transcript row", async () => {
        const harness = createJustBashToolHarness({
            files: { "/workspace/stable.txt": "stable\n" },
        });

        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: ["*** Begin Patch", "*** End Patch"].join("\n"),
            }),
        ).rejects.toThrow("no file changes were provided");
        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Update File: stable.txt",
                    "@@",
                    "-stable",
                    "+stable",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("update contains no changes for stable.txt");
        await expect(
            harness.runTool(codexApplyPatchTool, {
                workdir: "/workspace",
                patch: [
                    "*** Begin Patch",
                    "*** Add File: ghost.txt",
                    "+temporary",
                    "*** Delete File: ghost.txt",
                    "*** End Patch",
                ].join("\n"),
            }),
        ).rejects.toThrow("patch makes no changes");

        expect(await harness.readFile("/workspace/stable.txt")).toBe("stable\n");
        await expect(harness.readFile("/workspace/ghost.txt")).rejects.toThrow();
    });
});
