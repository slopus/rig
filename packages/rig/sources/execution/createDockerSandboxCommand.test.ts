import { describe, expect, it } from "vitest";

import { createDockerSandboxCommand } from "./createDockerSandboxCommand.js";

const runtime = {
    bwrapPath: "/usr/bin/bwrap",
};

describe("createDockerSandboxCommand", () => {
    it("makes the workspace read-only and isolates networking in Read only mode", () => {
        const command = createDockerSandboxCommand({
            command: "touch changed.txt",
            commandCwd: "/workspace",
            mode: "read_only",
            protectedPaths: ["/tmp/rig-exec.pid"],
            runtime,
            shell: "/bin/sh",
            workspaceCwd: "/workspace",
        });

        expect(command).toContain("--unshare-net");
        expect(command).toContain("--unshare-pid");
        expect(command).toContain("--unshare-user");
        expect(bindMode(command, "/workspace")).toBeUndefined();
        expect(bindMode(command, "/tmp")).toBeUndefined();
        expect(bindMode(command, "/tmp/rig-exec.pid")).toBe("--ro-bind");
        expect(command.slice(-3)).toEqual(["/bin/sh", "-lc", "touch changed.txt"]);
    });

    it("makes only the workspace and temporary directory writable in Workspace write mode", () => {
        const command = createDockerSandboxCommand({
            command: "touch changed.txt",
            commandCwd: "/workspace/packages/rig",
            mode: "workspace_write",
            runtime,
            shell: "/bin/sh",
            workspaceCwd: "/workspace",
        });

        expect(bindMode(command, "/")).toBe("--ro-bind");
        expect(bindMode(command, "/tmp")).toBe("--bind");
        expect(bindMode(command, "/workspace")).toBe("--bind");
        expect(command).not.toContain("--tmpfs");
        expect(bindMode(command, "/workspace/.git")).toBe("--ro-bind-try");
        expect(command.slice(command.indexOf("--chdir"), command.indexOf("--chdir") + 2)).toEqual([
            "--chdir",
            "/workspace/packages/rig",
        ]);
    });
});

function bindMode(command: readonly string[], target: string): string | undefined {
    const targetIndex = command.findIndex(
        (argument, index) => argument === target && command[index - 1] === target,
    );
    return targetIndex < 2 ? undefined : command[targetIndex - 2];
}
