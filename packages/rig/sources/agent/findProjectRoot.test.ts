import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createNodeFileSystemContext } from "./context/createNodeFileSystemContext.js";
import { findProjectRoot } from "./findProjectRoot.js";
import type { PermissionMode } from "../permissions/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("findProjectRoot", () => {
    it("treats restricted ancestor marker paths as unavailable", async () => {
        const home = await mkdtemp(join(tmpdir(), "rig-project-root-"));
        temporaryDirectories.push(home);
        const workspace = join(home, "projects", "workspace");
        await mkdir(workspace, { recursive: true });
        let mode: PermissionMode = "workspace_write";
        const fs = createNodeFileSystemContext(workspace, {
            home,
            permissionMode: () => mode,
        });

        for (const restrictedMode of ["read_only", "workspace_write", "auto"] as const) {
            mode = restrictedMode;
            await expect(findProjectRoot(fs)).resolves.toBeUndefined();
        }
    });

    it("finds an accessible marker inside the workspace", async () => {
        const workspace = await mkdtemp(join(tmpdir(), "rig-project-root-"));
        temporaryDirectories.push(workspace);
        await writeFile(join(workspace, ".git"), "gitdir: elsewhere\n");
        const fs = createNodeFileSystemContext(workspace, {
            home: workspace,
            permissionMode: () => "workspace_write",
        });

        await expect(findProjectRoot(fs)).resolves.toBe(workspace);
    });
});
