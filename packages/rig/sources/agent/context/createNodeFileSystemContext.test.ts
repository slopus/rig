import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createNodeFileSystemContext } from "./createNodeFileSystemContext.js";
import type { PermissionMode } from "../../permissions/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("createNodeFileSystemContext", () => {
    it("defaults to the workspace-write boundary", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-fs-safe-default-"));
        temporaryDirectories.push(root);
        const workspace = join(root, "workspace");
        await mkdir(workspace);
        const context = createNodeFileSystemContext(workspace);

        await expect(context.writeFile(join(root, "outside.txt"), "outside\n")).rejects.toThrow(
            "cannot modify files outside the working directory",
        );
        await expect(context.writeFile("inside.txt", "inside\n")).resolves.toBeUndefined();
    });

    it("uses Codex-style host reads without allowing outside writes on Linux", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-fs-user-skills-"));
        temporaryDirectories.push(root);
        const home = join(root, "home");
        const workspace = join(home, "projects", "workspace");
        const skillDirectory = join(home, ".codex", "skills", "review");
        const skillFile = join(skillDirectory, "SKILL.md");
        const privateDocument = join(home, "private.txt");
        const escapedReference = join(skillDirectory, "private-link.txt");
        await mkdir(workspace, { recursive: true });
        await mkdir(skillDirectory, { recursive: true });
        await writeFile(skillFile, "# Review\n");
        await writeFile(privateDocument, "private\n");
        await symlink(privateDocument, escapedReference);
        let mode: PermissionMode = "workspace_write";
        const context = createNodeFileSystemContext(workspace, {
            home,
            permissionMode: () => mode,
            platform: "linux",
        });

        for (const restrictedMode of ["read_only", "workspace_write", "auto"] as const) {
            mode = restrictedMode;
            await expect(context.readFile(skillFile)).resolves.toBe("# Review\n");
            await expect(context.readdir(skillDirectory)).resolves.toEqual([
                "SKILL.md",
                "private-link.txt",
            ]);
            await expect(context.readFile(privateDocument)).resolves.toBe("private\n");
            await expect(context.readFile(escapedReference)).resolves.toBe("private\n");
        }

        mode = "workspace_write";
        await expect(context.writeFile(skillFile, "changed\n")).rejects.toThrow(
            "cannot modify files outside the working directory",
        );
        await expect(readFile(skillFile, "utf8")).resolves.toBe("# Review\n");
    });

    it("allows direct and symlinked host reads in every restricted mode on Linux", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-fs-security-"));
        temporaryDirectories.push(root);
        const home = join(root, "home");
        const workspace = join(home, "projects", "workspace");
        const privateDocument = join(home, "Documents", "medical-note.txt");
        const desktopFile = join(home, "Desktop", "personal-note.txt");
        const browserHistory = join(
            home,
            "Library",
            "Application Support",
            "Chromium",
            "Default",
            "History",
        );
        await mkdir(join(home, "Documents"), { recursive: true });
        await mkdir(join(home, "Desktop"), { recursive: true });
        await mkdir(join(browserHistory, ".."), { recursive: true });
        await mkdir(workspace, { recursive: true });
        await writeFile(privateDocument, "synthetic medical details");
        await writeFile(desktopFile, "synthetic personal note");
        await writeFile(browserHistory, "synthetic browser history");
        await writeFile(join(workspace, "ordinary.txt"), "ordinary");
        await symlink(privateDocument, join(workspace, "private-link"));
        let mode: PermissionMode = "workspace_write";
        const context = createNodeFileSystemContext(workspace, {
            home,
            permissionMode: () => mode,
            platform: "linux",
        });

        for (const restrictedMode of ["read_only", "workspace_write", "auto"] as const) {
            mode = restrictedMode;
            await expect(context.readFile("ordinary.txt")).resolves.toBe("ordinary");
            await expect(context.readFile(privateDocument)).resolves.toBe(
                "synthetic medical details",
            );
            await expect(context.readFile(desktopFile)).resolves.toBe("synthetic personal note");
            await expect(context.readFile(browserHistory)).resolves.toBe(
                "synthetic browser history",
            );
            await expect(context.readFile("private-link")).resolves.toBe(
                "synthetic medical details",
            );
            await expect(context.readFileBuffer(privateDocument)).resolves.toEqual(
                Buffer.from("synthetic medical details"),
            );
            await expect(context.readdir(home)).resolves.toEqual(
                expect.arrayContaining(["Desktop", "Documents", "Library", "projects"]),
            );
            await expect(context.stat(privateDocument)).resolves.toMatchObject({ size: 25 });
            await expect(context.exists(privateDocument)).resolves.toBe(true);
        }

        mode = "full_access";
        await expect(context.readFile(privateDocument)).resolves.toBe("synthetic medical details");
        await expect(context.readFile(desktopFile)).resolves.toBe("synthetic personal note");
        await expect(context.readFile(browserHistory)).resolves.toBe("synthetic browser history");
        await expect(readFile(privateDocument, "utf8")).resolves.toBe("synthetic medical details");
    });

    it("uses Codex-style host reads without allowing outside writes on macOS", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-fs-macos-"));
        temporaryDirectories.push(root);
        const home = join(root, "home");
        const workspace = join(root, "workspace");
        const outside = join(home, ".gitconfig");
        await mkdir(home);
        await mkdir(workspace);
        await writeFile(outside, "[core]\n");
        let mode: PermissionMode = "workspace_write";
        const context = createNodeFileSystemContext(workspace, {
            home,
            permissionMode: () => mode,
            platform: "darwin",
        });

        for (const restrictedMode of ["read_only", "workspace_write", "auto"] as const) {
            mode = restrictedMode;
            await expect(context.readFile(outside)).resolves.toBe("[core]\n");
            await expect(context.writeFile(outside, "changed\n")).rejects.toThrow();
        }
        await expect(readFile(outside, "utf8")).resolves.toBe("[core]\n");
    });
});
