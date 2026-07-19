import { describe, expect, it } from "vitest";

import { assertDockerReadPath } from "./assertDockerReadPath.js";

describe("assertDockerReadPath", () => {
    it("allows Codex-style host reads in restricted modes", () => {
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
            expect(assertDockerReadPath("/workspace", path)).toBe(path);
        }
    });

    it("allows workspace and absolute host reads", () => {
        expect(assertDockerReadPath("/workspace", ".npmrc")).toBe("/workspace/.npmrc");
        expect(assertDockerReadPath("/workspace", "/home/dev/.npmrc")).toBe("/home/dev/.npmrc");
    });

    it("does not rewrite relative host-readable paths", () => {
        expect(assertDockerReadPath("/workspace", "credentials")).toBe("/workspace/credentials");
    });
});
