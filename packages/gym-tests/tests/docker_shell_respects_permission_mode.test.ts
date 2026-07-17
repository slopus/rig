import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const execFileAsync = promisify(execFile);
const running = new Set<Gym>();
const managedContainers = new Set<string>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
    await Promise.all(
        [...managedContainers].map((name) =>
            execFileAsync("docker", ["rm", "--force", name]).catch(() => undefined),
        ),
    );
    managedContainers.clear();
});

describe("Docker shell permissions", () => {
    it("blocks workspace and system writes in Read only mode", async () => {
        const before = new Set(await listManagedContainers());
        const gym = await createGym({
            args: ["--docker-image", "rig-gym:local", "--docker-workdir", "/workspace"],
            dockerSocket: true,
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: "(printf 'workspace write\n' > /workspace/read-only-write.txt) 2>/dev/null || true; (printf 'system write\n' > /etc/rig-read-only-write) 2>/dev/null || true",
                            },
                            id: "read-only-command",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Read only Docker command finished.", type: "text" }] },
            ],
            permissionMode: "read_only",
        });
        running.add(gym);

        gym.terminal.type("Try both writes from the Docker shell.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Read only Docker command finished.", 40_000);

        const container = await captureManagedContainer(before);
        await expect(pathExists(container, "/workspace/read-only-write.txt")).resolves.toBe(false);
        await expect(pathExists(container, "/etc/rig-read-only-write")).resolves.toBe(false);
    }, 60_000);

    it("limits Workspace write commands to the workspace and isolates their network", async () => {
        const before = new Set(await listManagedContainers());
        const gym = await createGym({
            args: ["--docker-image", "rig-gym:local", "--docker-workdir", "/workspace"],
            dockerSocket: true,
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: "printf 'workspace write\n' > /workspace/workspace-write.txt; readlink /proc/self/ns/net > /workspace/sandbox-network.txt; (printf 'system write\n' > /etc/rig-workspace-write) 2>/dev/null || true",
                            },
                            id: "workspace-write-command",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Workspace write Docker command finished.", type: "text" }] },
            ],
            permissionMode: "workspace_write",
        });
        running.add(gym);

        gym.terminal.type("Write inside the workspace and test the Docker boundary.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Workspace write Docker command finished.", 40_000);

        const container = await captureManagedContainer(before);
        await expect(readContainerFile(container, "/workspace/workspace-write.txt")).resolves.toBe(
            "workspace write\n",
        );
        await expect(pathExists(container, "/etc/rig-workspace-write")).resolves.toBe(false);
        const sandboxNetwork = await readContainerFile(container, "/workspace/sandbox-network.txt");
        const containerNetwork = await execFileAsync("docker", [
            "exec",
            container,
            "readlink",
            "/proc/1/ns/net",
        ]).then(({ stdout }) => stdout);
        expect(sandboxNetwork).not.toBe(containerNetwork);
        const runtimeMetadata = await execFileAsync("docker", [
            "exec",
            container,
            "/bin/sh",
            "-c",
            'directory=$(find /tmp -maxdepth 1 -type d -name "rig-sandbox-*" -print -quit); stat -c "%u:%g %a" "$directory" "$directory/apply-seccomp"',
        ]).then(({ stdout }) => stdout);
        expect(runtimeMetadata).toBe("0:0 755\n0:0 755\n");
    }, 60_000);
});

async function captureManagedContainer(before: ReadonlySet<string>): Promise<string> {
    const created = (await listManagedContainers()).filter((name) => !before.has(name));
    expect(created).toHaveLength(1);
    const container = created[0] ?? "";
    managedContainers.add(container);
    return container;
}

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

async function readContainerFile(container: string, path: string): Promise<string> {
    return execFileAsync("docker", ["exec", container, "cat", path]).then(({ stdout }) => stdout);
}
