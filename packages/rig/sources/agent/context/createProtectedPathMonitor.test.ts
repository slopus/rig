import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProtectedPathMonitor } from "./createProtectedPathMonitor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("createProtectedPathMonitor", () => {
    it("removes protected files and directories created after monitoring starts", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-protected-path-monitor-"));
        temporaryDirectories.push(root);
        const agentsPath = join(root, ".agents");
        const codexPath = join(root, ".codex");
        const monitor = await createProtectedPathMonitor([agentsPath, codexPath]);

        await mkdir(agentsPath);
        await writeFile(join(agentsPath, "instructions.md"), "poisoned\n").catch(() => undefined);
        await writeFile(codexPath, "poisoned\n");

        await expect(monitor.stop()).resolves.toBe(true);
        await expect(lstatMissing(agentsPath)).resolves.toBe(true);
        await expect(lstatMissing(codexPath)).resolves.toBe(true);
    });

    it("does not create absent protected paths", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-protected-path-absence-"));
        temporaryDirectories.push(root);
        const protectedPath = join(root, ".codex");
        const monitor = await createProtectedPathMonitor([protectedPath]);

        await expect(lstatMissing(protectedPath)).resolves.toBe(true);
        await expect(monitor.stop()).resolves.toBe(false);
        await expect(lstatMissing(protectedPath)).resolves.toBe(true);
    });
});

async function lstatMissing(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return false;
    } catch (error) {
        return error instanceof Error && "code" in error && error.code === "ENOENT";
    }
}
