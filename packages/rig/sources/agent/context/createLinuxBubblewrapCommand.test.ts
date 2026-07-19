import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLinuxBubblewrapCommand } from "./createLinuxBubblewrapCommand.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("createLinuxBubblewrapCommand", () => {
    it("uses a read-only host view with isolated networking in Read only mode", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-bwrap-read-only-"));
        temporaryDirectories.push(root);

        const result = await createLinuxBubblewrapCommand({
            bwrapPath: "/usr/bin/bwrap",
            command: "git status --short",
            commandCwd: root,
            cwd: root,
            mode: "read_only",
            shell: "/bin/sh",
            temporaryDirectory: join(root, "tmp"),
        });

        expect(result.command).toBe("/usr/bin/bwrap");
        expect(bindMode(result.args, "/")).toBe("--ro-bind");
        expect(bindMode(result.args, root)).toBeUndefined();
        expect(result.args).toContain("--unshare-net");
        expect(result.args).toContain("--unshare-user");
        expect(result.args).toContain("--unshare-pid");
        expect(result.args.slice(-4)).toEqual(["--", "/bin/sh", "-lc", "git status --short"]);
    });

    it("rebinds writable roots before protecting metadata and Rig control paths", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-bwrap-workspace-write-"));
        temporaryDirectories.push(root);
        const cwd = join(root, "workspace");
        const temporaryDirectory = join(root, "tmp");
        const gitDirectory = join(cwd, ".git");
        const agentsDirectory = join(cwd, ".agents");
        const codexDirectory = join(cwd, ".codex");
        const controlDirectory = join(temporaryDirectory, "rig-123");
        const tokenPath = join(controlDirectory, "token");
        await Promise.all([
            mkdir(gitDirectory, { recursive: true }),
            mkdir(agentsDirectory, { recursive: true }),
            mkdir(codexDirectory, { recursive: true }),
            mkdir(controlDirectory, { recursive: true }),
        ]);
        await writeFile(tokenPath, "secret\n");
        const canonicalCwd = await realpath(cwd);
        const canonicalTemporaryDirectory = await realpath(temporaryDirectory);

        const result = await createLinuxBubblewrapCommand({
            bwrapPath: "/usr/bin/bwrap",
            command: "true",
            commandCwd: cwd,
            cwd,
            environment: { RIG_SERVER_TOKEN_PATH: tokenPath },
            mode: "workspace_write",
            shell: "/bin/sh",
            temporaryDirectory,
            uid: 123,
        });

        expect(bindMode(result.args, canonicalCwd)).toBe("--bind");
        expect(bindMode(result.args, canonicalTemporaryDirectory)).toBe("--bind");
        for (const protectedPath of [
            gitDirectory,
            agentsDirectory,
            codexDirectory,
            controlDirectory,
            tokenPath,
        ]) {
            expect(bindMode(result.args, protectedPath)).toBe("--ro-bind");
            expect(lastBindIndex(result.args, protectedPath)).toBeGreaterThan(
                lastBindIndex(result.args, canonicalCwd),
            );
        }
        expect(result.args.slice(-6)).toEqual([
            "--chdir",
            canonicalCwd,
            "--",
            "/bin/sh",
            "-lc",
            "true",
        ]);
    });

    it("reports absent protected paths for monitoring without creating placeholders", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-bwrap-missing-protected-"));
        temporaryDirectories.push(root);
        const cwd = join(root, "workspace");
        await mkdir(cwd);

        const result = await createLinuxBubblewrapCommand({
            bwrapPath: "/usr/bin/bwrap",
            command: "true",
            commandCwd: cwd,
            cwd,
            mode: "workspace_write",
            shell: "/bin/sh",
            temporaryDirectory: join(root, "tmp"),
        });
        const canonicalCwd = await realpath(cwd);

        for (const name of [".git", ".agents", ".codex"]) {
            const path = join(cwd, name);
            expect(result.protectedCreatePaths).toContain(join(canonicalCwd, name));
            await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
        }
    });
});

function bindMode(command: readonly string[], target: string): string | undefined {
    const targetIndex = lastBindIndex(command, target);
    return targetIndex < 2 ? undefined : command[targetIndex - 2];
}

function lastBindIndex(command: readonly string[], target: string): number {
    return command.findLastIndex(
        (argument, index) => argument === target && command[index - 1] === target,
    );
}
