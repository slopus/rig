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

describe("direct filesystem Git control protection", () => {
    it("blocks writes, directory creation, and removal throughout Git metadata", async () => {
        const workspace = await createRepositoryFixture();
        const context = createNodeFileSystemContext(workspace, {
            permissionMode: () => "workspace_write",
        });

        await expect(
            context.writeFile(".git/config", "[core]\n\thooksPath = hooks\n"),
        ).rejects.toThrow("cannot modify Git control files");
        await expect(context.mkdir(".git/hooks/new", { recursive: true })).rejects.toThrow(
            "cannot modify Git control files",
        );
        await expect(context.rm(".git/hooks", { recursive: true })).rejects.toThrow(
            "cannot modify Git control files",
        );
        await expect(context.writeFile("nested/.git/config", "[core]\n")).rejects.toThrow(
            "cannot modify Git control files",
        );
        await expect(context.writeFile("nested/.gitconfig", "[alias]\n")).rejects.toThrow(
            "cannot modify Git control files",
        );
        await expect(context.writeFile("nested/.gitmodules", "[submodule]\n")).rejects.toThrow(
            "cannot modify Git control files",
        );

        await expect(readFile(join(workspace, ".git", "config"), "utf8")).resolves.toBe("[core]\n");
        await expect(readFile(join(workspace, ".git", "hooks", "existing"), "utf8")).resolves.toBe(
            "existing hook\n",
        );
    });

    it("blocks symlink aliases while allowing normal source files in every restricted write mode", async () => {
        const workspace = await createRepositoryFixture();
        await symlink(join(workspace, ".git", "config"), join(workspace, "config-link"));
        await symlink(join(workspace, ".git"), join(workspace, "metadata-link"));
        let mode: PermissionMode = "workspace_write";
        const context = createNodeFileSystemContext(workspace, {
            permissionMode: () => mode,
        });

        for (const restrictedMode of ["workspace_write", "auto"] as const) {
            mode = restrictedMode;
            await expect(context.writeFile("config-link", "compromised\n")).rejects.toThrow(
                "cannot modify Git control files",
            );
            await expect(context.writeFile("metadata-link/hooks/new", "hook\n")).rejects.toThrow(
                "cannot modify Git control files",
            );
            await context.mkdir("src", { recursive: true });
            await context.writeFile("src/feature.ts", `export const mode = "${restrictedMode}";\n`);
            await context.writeFile(".gitignore", "dist/\n");
            await expect(context.rm("src/feature.ts")).resolves.toBeUndefined();
        }

        await expect(readFile(join(workspace, ".git", "config"), "utf8")).resolves.toBe("[core]\n");
        await expect(readFile(join(workspace, ".gitignore"), "utf8")).resolves.toBe("dist/\n");
    });

    it("allows explicit Full access to modify Git control files", async () => {
        const workspace = await createRepositoryFixture();
        const context = createNodeFileSystemContext(workspace, {
            permissionMode: () => "full_access",
        });

        await context.writeFile(".git/config", "[core]\n\thooksPath = hooks\n");
        await context.mkdir(".git/hooks/nested", { recursive: true });
        await context.writeFile(".git/hooks/nested/post-checkout", "#!/bin/sh\n");
        await context.rm(".git/hooks/existing");

        await expect(readFile(join(workspace, ".git", "config"), "utf8")).resolves.toContain(
            "hooksPath",
        );
        await expect(
            readFile(join(workspace, ".git", "hooks", "nested", "post-checkout"), "utf8"),
        ).resolves.toBe("#!/bin/sh\n");
    });
});

async function createRepositoryFixture(): Promise<string> {
    const workspace = await mkdtemp(join(tmpdir(), "rig-direct-git-security-"));
    temporaryDirectories.push(workspace);
    await mkdir(join(workspace, ".git", "hooks"), { recursive: true });
    await mkdir(join(workspace, "nested", ".git"), { recursive: true });
    await writeFile(join(workspace, ".git", "config"), "[core]\n");
    await writeFile(join(workspace, ".git", "hooks", "existing"), "existing hook\n");
    return workspace;
}
