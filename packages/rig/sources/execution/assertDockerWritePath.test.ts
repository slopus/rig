import { describe, expect, it } from "vitest";

import { assertDockerWritePath } from "./assertDockerWritePath.js";

describe("assertDockerWritePath", () => {
    it("blocks Git configuration files in workspace write mode", async () => {
        for (const path of [".gitmodules", "nested/.gitconfig", "nested/.GITMODULES"]) {
            await expect(
                assertDockerWritePath("/workspace", path, "workspace_write", identity),
            ).rejects.toThrow(
                "Workspace write mode cannot modify Git control files without Full access.",
            );
        }
    });

    it("allows ordinary workspace files and Full access Git configuration writes", async () => {
        await expect(
            assertDockerWritePath("/workspace", "src/index.ts", "workspace_write", identity),
        ).resolves.toBe("/workspace/src/index.ts");
        await expect(
            assertDockerWritePath("/workspace", ".gitmodules", "full_access", identity),
        ).resolves.toBe("/workspace/.gitmodules");
    });

    it("blocks symlinks that escape the workspace or alias Git control files", async () => {
        await expect(
            assertDockerWritePath("/workspace", "escape/file", "workspace_write", async (path) =>
                path === "/workspace/escape/file" ? "/outside/file" : path,
            ),
        ).rejects.toThrow("cannot modify files outside the working directory");
        await expect(
            assertDockerWritePath("/workspace", "config-alias", "workspace_write", async (path) =>
                path === "/workspace/config-alias" ? "/workspace/.git/config" : path,
            ),
        ).rejects.toThrow(
            "Workspace write mode cannot modify Git control files without Full access.",
        );
    });
});

async function identity(path: string): Promise<string> {
    return path;
}
