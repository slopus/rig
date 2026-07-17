import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const execFileAsync = promisify(execFile);
const running = new Set<Gym>();
const managedContainers = new Set<string>();
let baselineManagedContainers = new Set<string>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
    for (const name of await listManagedContainers()) {
        if (!baselineManagedContainers.has(name)) managedContainers.add(name);
    }
    await Promise.all(
        [...managedContainers].map((name) =>
            execFileAsync("docker", ["rm", "--force", name]).catch(() => undefined),
        ),
    );
    managedContainers.clear();
    baselineManagedContainers = new Set();
});

describe("Docker-backed sessions", () => {
    it("routes file and command tools into the session container", async () => {
        const before = new Set(await listManagedContainers());
        baselineManagedContainers = before;
        const gym = await createGym({
            args: [
                "--docker-image",
                "rig-gym:local",
                "--docker-workdir",
                "/workspace",
                "--docker-env",
                "RIG_DOCKER_MARKER=inside the session container",
            ],
            dockerSocket: true,
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: "printf '%s\\n' \"$RIG_DOCKER_MARKER\" > result.txt && chmod 755 result.txt && cat result.txt",
                            },
                            id: "call-1",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            arguments: {
                                patch: "*** Begin Patch\n*** Update File: /workspace/result.txt\n@@\n inside the session container\n+edited through container filesystem\n*** End Patch",
                            },
                            id: "call-2",
                            name: "apply_patch",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Docker workspace verified.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Write the environment marker and read it back.");
        gym.terminal.press("enter");

        const screen = await gym.terminal.waitForText("Docker workspace verified.", 40_000);
        expect(screen.text).toContain("inside the session container");
        await expect(gym.readFile("result.txt")).rejects.toThrow();

        const created = (await listManagedContainers()).filter((name) => !before.has(name));
        expect(created).toHaveLength(1);
        for (const name of created) managedContainers.add(name);
        const { stdout } = await execFileAsync("docker", [
            "exec",
            created[0] ?? "",
            "cat",
            "/workspace/result.txt",
        ]);
        expect(stdout).toBe("inside the session container\nedited through container filesystem\n");
        const { stdout: metadata } = await execFileAsync("docker", [
            "exec",
            created[0] ?? "",
            "stat",
            "-c",
            "%u:%g %a",
            "/workspace/result.txt",
        ]);
        expect(metadata).toBe("1000:1000 755\n");
    }, 60_000);

    it("connects to an existing running container selected for the session", async () => {
        baselineManagedContainers = new Set(await listManagedContainers());
        const containerName = `rig-existing-${randomUUID()}`;
        managedContainers.add(containerName);
        await execFileAsync("docker", [
            "run",
            "--detach",
            "--name",
            containerName,
            "--security-opt",
            "seccomp=unconfined",
            "--entrypoint",
            "/bin/sh",
            "rig-gym:local",
            "-c",
            "while :; do sleep 3600; done",
        ]);
        const gym = await createGym({
            args: ["--docker-container", containerName, "--docker-workdir", "/workspace"],
            dockerSocket: true,
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: "printf 'connected to existing container\\n' > result.txt",
                            },
                            id: "call-existing",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Existing container verified.", type: "text" }] },
            ],
            permissionMode: "workspace_write",
        });
        running.add(gym);

        gym.terminal.type("Write a marker in the selected running container.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Existing container verified.", 40_000);

        const { stdout } = await execFileAsync("docker", [
            "exec",
            containerName,
            "cat",
            "/workspace/result.txt",
        ]);
        expect(stdout).toBe("connected to existing container\n");
        await expect(gym.readFile("result.txt")).rejects.toThrow();
    }, 60_000);

    it("fails closed when an existing container cannot create the command sandbox", async () => {
        baselineManagedContainers = new Set(await listManagedContainers());
        const containerName = `rig-existing-${randomUUID()}`;
        managedContainers.add(containerName);
        await execFileAsync("docker", [
            "run",
            "--detach",
            "--name",
            containerName,
            "--entrypoint",
            "/bin/sh",
            "rig-gym:local",
            "-c",
            "while :; do sleep 3600; done",
        ]);
        const gym = await createGym({
            args: ["--docker-container", containerName, "--docker-workdir", "/workspace"],
            dockerSocket: true,
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "printf 'escaped sandbox\n' > result.txt" },
                            id: "call-unsupported-sandbox",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Unsupported sandbox handled.", type: "text" }] },
            ],
            permissionMode: "workspace_write",
        });
        running.add(gym);

        gym.terminal.type("Try the command without Docker namespace support.");
        gym.terminal.press("enter");
        const screen = await gym.terminal.waitForText("Unsupported sandbox handled.", 40_000);

        expect(screen.text).toContain("nested user namespaces");
        await expect(pathExists(containerName, "/workspace/result.txt")).resolves.toBe(false);
    }, 60_000);

    it("blocks direct file writes through workspace symlinks that escape the container workspace", async () => {
        const before = new Set(await listManagedContainers());
        baselineManagedContainers = before;
        const gym = await createGym({
            args: ["--docker-image", "rig-gym:local", "--docker-workdir", "/workspace"],
            dockerSocket: true,
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: "mkdir -p /tmp/rig-outside && printf 'protected outside content\\n' > /tmp/rig-outside/target.txt && ln -s /tmp/rig-outside/target.txt alias.txt",
                            },
                            id: "call-create-symlink",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            arguments: {
                                patch: "*** Begin Patch\n*** Update File: /workspace/alias.txt\n@@\n-protected outside content\n+overwritten through symlink\n*** End Patch",
                            },
                            id: "call-write-symlink",
                            name: "apply_patch",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Symlink guard verified.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Try to overwrite the symlink target with the direct file tool.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Symlink guard verified.", 40_000);

        const created = (await listManagedContainers()).filter((name) => !before.has(name));
        expect(created).toHaveLength(1);
        for (const name of created) managedContainers.add(name);
        const { stdout } = await execFileAsync("docker", [
            "exec",
            created[0] ?? "",
            "cat",
            "/tmp/rig-outside/target.txt",
        ]);
        expect(stdout).toBe("protected outside content\n");
    }, 60_000);
});

async function listManagedContainers(): Promise<string[]> {
    const { stdout } = await execFileAsync("docker", [
        "ps",
        "--all",
        "--filter",
        "label=dev.rig.managed=true",
        "--format",
        "{{.Names}}",
    ]);
    return stdout.split("\n").filter(Boolean);
}

async function pathExists(container: string, path: string): Promise<boolean> {
    return execFileAsync("docker", ["exec", container, "test", "-e", path]).then(
        () => true,
        () => false,
    );
}
