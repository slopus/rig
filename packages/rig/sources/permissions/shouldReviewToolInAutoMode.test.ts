import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { shouldReviewToolInAutoMode } from "./shouldReviewToolInAutoMode.js";

describe("shouldReviewToolInAutoMode", () => {
    const tempDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            tempDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
        );
    });

    it("fast-paths internal and workspace file actions", async () => {
        const cwd = await makeWorkspace(tempDirectories);
        await expect(shouldReviewToolInAutoMode("TaskList", {}, cwd)).resolves.toBe(false);
        await expect(
            shouldReviewToolInAutoMode("Write", { file_path: join(cwd, "src/app.ts") }, cwd),
        ).resolves.toBe(false);
        await expect(
            shouldReviewToolInAutoMode(
                "apply_patch",
                {
                    patch: "*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch",
                },
                cwd,
            ),
        ).resolves.toBe(false);
        await expect(
            shouldReviewToolInAutoMode("write_stdin", { session_id: 1 }, cwd),
        ).resolves.toBe(false);
    });

    it("reviews shell, external-path, symlink, interactive, and unknown actions", async () => {
        const cwd = await makeWorkspace(tempDirectories);
        const outside = join(cwd, "..", "secret.txt");
        await writeFile(outside, "secret");
        const link = join(cwd, "secret-link");
        await symlink(outside, link);

        await expect(
            shouldReviewToolInAutoMode("Bash", { command: "pnpm test" }, cwd),
        ).resolves.toBe(true);
        await expect(shouldReviewToolInAutoMode("Read", { file_path: outside }, cwd)).resolves.toBe(
            true,
        );
        await expect(shouldReviewToolInAutoMode("Read", { file_path: link }, cwd)).resolves.toBe(
            true,
        );
        await expect(
            shouldReviewToolInAutoMode("write_stdin", { chars: "deploy\n" }, cwd),
        ).resolves.toBe(true);
        await expect(shouldReviewToolInAutoMode("mcp_publish", {}, cwd)).resolves.toBe(true);
        await mkdir(join(cwd, ".git", "hooks"), { recursive: true });
        await expect(
            shouldReviewToolInAutoMode(
                "Write",
                { file_path: join(cwd, ".git", "hooks", "pre-commit") },
                cwd,
            ),
        ).resolves.toBe(true);
        await expect(
            shouldReviewToolInAutoMode(
                "apply_patch",
                {
                    patch: "*** Begin Patch\n*** Add File: .git/hooks/pre-commit\n+#!/bin/sh\n*** End Patch",
                },
                cwd,
            ),
        ).resolves.toBe(true);
    });
});

async function makeWorkspace(tempDirectories: string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "rig-auto-permissions-"));
    tempDirectories.push(root);
    const cwd = join(root, "workspace");
    await mkdir(cwd);
    return cwd;
}
