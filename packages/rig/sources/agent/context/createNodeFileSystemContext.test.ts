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
    it("reads user skill trees without exposing other private home files", async () => {
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
        });

        for (const restrictedMode of ["read_only", "workspace_write", "auto"] as const) {
            mode = restrictedMode;
            await expect(context.readFile(skillFile)).resolves.toBe("# Review\n");
            await expect(context.readdir(skillDirectory)).resolves.toEqual([
                "SKILL.md",
                "private-link.txt",
            ]);
            await expect(context.readFile(privateDocument)).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.readFile(escapedReference)).rejects.toThrow(
                "private files outside the workspace",
            );
        }

        mode = "workspace_write";
        await expect(context.writeFile(skillFile, "changed\n")).rejects.toThrow(
            "cannot modify files outside the working directory",
        );
        await expect(readFile(skillFile, "utf8")).resolves.toBe("# Review\n");
    });

    it("blocks direct and symlinked private home reads in every restricted mode", async () => {
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
        });

        for (const restrictedMode of ["read_only", "workspace_write", "auto"] as const) {
            mode = restrictedMode;
            await expect(context.readFile("ordinary.txt")).resolves.toBe("ordinary");
            await expect(context.readFile(privateDocument)).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.readFile(desktopFile)).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.readFile(browserHistory)).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.readFile("private-link")).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.readFileBuffer(privateDocument)).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.readdir(home)).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.stat(privateDocument)).rejects.toThrow(
                "private files outside the workspace",
            );
            await expect(context.exists(privateDocument)).rejects.toThrow(
                "private files outside the workspace",
            );
        }

        mode = "full_access";
        await expect(context.readFile(privateDocument)).resolves.toBe("synthetic medical details");
        await expect(context.readFile(desktopFile)).resolves.toBe("synthetic personal note");
        await expect(context.readFile(browserHistory)).resolves.toBe("synthetic browser history");
        await expect(readFile(privateDocument, "utf8")).resolves.toBe("synthetic medical details");
    });
});
