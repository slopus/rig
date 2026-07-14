import { describe, expect, it } from "vitest";

import { assertDockerReadPath } from "./assertDockerReadPath.js";

describe("assertDockerReadPath", () => {
    it("blocks the same common credential locations as local execution", async () => {
        const privatePaths = [
            "/home/dev/.git-credentials",
            "/home/dev/.npmrc",
            "/home/dev/.config/gh/hosts.yml",
            "/home/dev/.kube/config",
            "/home/dev/.gnupg/pubring.kbx",
            "/home/dev/.netrc",
            "/home/dev/.docker/config.json",
            "/home/dev/Library/Keychains/login.keychain-db",
            "/home/dev/.SSH/id_rsa",
        ];

        for (const path of privatePaths) {
            await expect(
                assertDockerReadPath("/workspace", path, "workspace_write", identity),
            ).rejects.toThrow(
                "Restricted permissions block reading private files outside the workspace",
            );
        }
    });

    it("allows workspace files and Full access reads", async () => {
        await expect(
            assertDockerReadPath("/workspace", ".npmrc", "workspace_write", identity),
        ).resolves.toBe("/workspace/.npmrc");
        await expect(
            assertDockerReadPath("/workspace", "/home/dev/.npmrc", "full_access", identity),
        ).resolves.toBe("/home/dev/.npmrc");
    });

    it("blocks a workspace symlink that resolves to a private path", async () => {
        await expect(
            assertDockerReadPath("/workspace", "credentials", "workspace_write", async (path) =>
                path === "/workspace/credentials" ? "/root/.ssh" : path,
            ),
        ).rejects.toThrow(
            "Restricted permissions block reading private files outside the workspace",
        );
    });
});

async function identity(path: string): Promise<string> {
    return path;
}
