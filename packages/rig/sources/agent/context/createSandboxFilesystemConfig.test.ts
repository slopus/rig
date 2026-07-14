import { describe, expect, it } from "vitest";

import { createSandboxFilesystemConfig } from "./createSandboxFilesystemConfig.js";

describe("createSandboxFilesystemConfig", () => {
    it("denies the private home directory and re-allows the selected workspace", async () => {
        const config = await createSandboxFilesystemConfig({
            cwd: "/home/tester/projects/rig",
            environment: {
                AWS_SHARED_CREDENTIALS_FILE: "/secrets/aws-credentials",
                CLAUDE_CONFIG_DIR: "/secrets/claude",
                CODEX_HOME: "/secrets/codex",
                RIG_SERVER_DIRECTORY: "/workspace/.rig-dev",
                RIG_SERVER_SOCKET_PATH: "/run/rig/custom-socket",
                RIG_SERVER_TOKEN_PATH: "/run/rig/custom-token",
                XDG_CONFIG_HOME: "/home/tester/custom-config",
            },
            homeDirectory: "/home/tester",
            mode: "workspace_write",
            sandboxConfigDirectory: "/temporary/rig-sandbox-policy",
            temporaryDirectory: "/temporary",
            uid: 123,
        });

        expect(config.allowRead).toEqual(["/home/tester/projects/rig"]);
        expect(config.allowWrite).toContain("/home/tester/projects/rig");
        expect(config.allowWrite).toContain("/temporary");
        expect(config.denyRead).toEqual(
            expect.arrayContaining([
                "/home/tester",
                "/home/tester/.ssh",
                "/home/tester/.aws",
                "/home/tester/.claude",
                "/home/tester/.codex",
                "/home/tester/custom-config/gh",
                "/secrets/aws-credentials",
                "/secrets/claude",
                "/secrets/codex",
                "/run/rig/custom-token",
                "/workspace/.rig-dev",
                "/temporary/rig-123",
                "/temporary/rig-sandbox-policy",
            ]),
        );
        expect(config.denyWrite).toEqual([
            "/temporary/rig-123",
            "/workspace/.rig-dev",
            "/run/rig/custom-socket",
            "/run/rig/custom-token",
            "/temporary/rig-sandbox-policy",
        ]);
    });
});
