import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const runners = new Map<string, Promise<SharedDockerRunner>>();

export interface SharedDockerRunner {
    containerName: string;
    containerRoot: string;
    hostRoot: string;
}

export function acquireSharedDockerRunner(options: {
    dockerSocket: boolean;
    imageId: string;
    repositoryRoot: string;
}): Promise<SharedDockerRunner> {
    const key = `${options.imageId}\0${String(options.dockerSocket)}\0${options.repositoryRoot}`;
    let runner = runners.get(key);
    if (runner === undefined) {
        runner = startSharedDockerRunner(options).catch((error: unknown) => {
            runners.delete(key);
            throw error;
        });
        runners.set(key, runner);
    }
    return runner;
}

export async function createSharedDockerFixtureRoot(
    runner: SharedDockerRunner,
): Promise<{ containerRoot: string; hostRoot: string; stateRoot: string }> {
    const id = randomUUID();
    const hostRoot = join(runner.hostRoot, id);
    const stateRoot = `/gym-state/${id}`;
    await mkdir(hostRoot, { recursive: true });
    await chmod(hostRoot, 0o777);
    await execFileAsync("docker", [
        "exec",
        runner.containerName,
        "mkdir",
        "-p",
        `${stateRoot}/tmp`,
    ]);
    return {
        containerRoot: `${runner.containerRoot}/${id}`,
        hostRoot,
        stateRoot,
    };
}

export function dockerSandboxArguments(
    containerRoot: string,
    stateRoot: string,
    command: readonly string[],
): string[] {
    return [
        "bwrap",
        "--unshare-user",
        "--unshare-ipc",
        "--unshare-uts",
        "--bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--bind",
        `${containerRoot}/workspace`,
        "/workspace",
        "--bind",
        `${containerRoot}/home`,
        "/home/rig",
        "--bind",
        `${stateRoot}/tmp`,
        "/tmp",
        "--tmpfs",
        "/gyms",
        "--tmpfs",
        "/gym-state",
        "--chdir",
        "/workspace",
        "--",
        ...command,
    ];
}

async function startSharedDockerRunner(options: {
    dockerSocket: boolean;
    imageId: string;
    repositoryRoot: string;
}): Promise<SharedDockerRunner> {
    const runId = process.env.RIG_GYM_RUN_ID ?? `process-${String(process.pid)}`;
    const safeRunId = runId.replaceAll(/[^A-Za-z0-9_.-]/gu, "-").slice(0, 48);
    const keyHash = createHash("sha256")
        .update(options.imageId)
        .update(String(options.dockerSocket))
        .update(options.repositoryRoot)
        .digest("hex")
        .slice(0, 12);
    const containerName = `rig-gym-pool-${safeRunId}-${keyHash}`;
    const hostRoot = join(tmpdir(), `rig-gym-pool-${safeRunId}-${keyHash}`);
    const containerRoot = "/gyms";
    await mkdir(hostRoot, { recursive: true });
    await chmod(hostRoot, 0o777);

    const running = await inspectRunning(containerName);
    if (!running) {
        const arguments_ = [
            "run",
            "--detach",
            "--init",
            "--name",
            containerName,
            "--label",
            `rig.gym.run=${runId}`,
            "--security-opt",
            "seccomp=unconfined",
            "--add-host",
            "host.docker.internal:host-gateway",
            "--env",
            "NODE_OPTIONS=--import=/app/rig-source-hook.mjs",
            "--volume",
            `${hostRoot}:${containerRoot}`,
            "--volume",
            `${join(options.repositoryRoot, "packages/rig/sources")}:/app/packages/rig/sources:ro`,
            "--volume",
            `${join(options.repositoryRoot, "packages/rig/package.json")}:/app/packages/rig/package.json:ro`,
            "--volume",
            `${join(options.repositoryRoot, "packages/gym/sources/registerTypeScriptSourceHooks.mjs")}:/app/rig-source-hook.mjs:ro`,
            "--tmpfs",
            "/gym-state:uid=1000,gid=1000,mode=0777",
            ...(options.dockerSocket
                ? [
                      "--group-add",
                      "0",
                      "--group-add",
                      await dockerSocketGroupId(),
                      "--volume",
                      "/var/run/docker.sock:/var/run/docker.sock",
                  ]
                : []),
            "--entrypoint",
            "sleep",
            options.imageId,
            "infinity",
        ];
        await execFileAsync("docker", arguments_).catch(async (error: unknown) => {
            if (!(await waitForRunning(containerName))) throw error;
        });
    }

    return { containerName, containerRoot, hostRoot };
}

async function inspectRunning(containerName: string): Promise<boolean> {
    return execFileAsync("docker", ["inspect", "--format", "{{.State.Running}}", containerName])
        .then(({ stdout }) => stdout.trim() === "true")
        .catch(() => false);
}

async function waitForRunning(containerName: string): Promise<boolean> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await inspectRunning(containerName)) return true;
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 25);
        });
    }
    return false;
}

async function dockerSocketGroupId(): Promise<string> {
    return String((await stat("/var/run/docker.sock")).gid);
}
