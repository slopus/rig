import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "@lydell/node-pty";

import { buildGymImage } from "./buildGymImage.js";
import { createFixtureWorkspace } from "./createFixtureWorkspace.js";
import { GhosttyTerminal } from "./GhosttyTerminal.js";
import { Gym } from "./Gym.js";
import { MockInferenceServer } from "./MockInferenceServer.js";
import type { GymOptions } from "./types.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_IMAGE = "rig-gym:local";

export async function createGym(options: GymOptions): Promise<Gym> {
    const cols = options.cols ?? 100;
    const rows = options.rows ?? 32;
    const image = options.image ?? DEFAULT_IMAGE;
    const workspacePath = await createFixtureWorkspace(options.files);
    const inference = new MockInferenceServer(options.inference);
    const containerName = `rig-gym-${randomUUID()}`;
    let ghostty: GhosttyTerminal | undefined;
    let gym: Gym | undefined;
    try {
        const startedGhostty = await GhosttyTerminal.create(cols, rows);
        ghostty = startedGhostty;
        const [imageId] = await Promise.all([
            buildGymImage(image, repositoryRoot),
            inference.start(),
        ]);
        const pty = spawn(
            "docker",
            [
                "run",
                "--rm",
                "--init",
                "--interactive",
                "--tty",
                "--name",
                containerName,
                "--add-host",
                "host.docker.internal:host-gateway",
                "--env",
                `RIG_GYM_INFERENCE_URL=${inference.url}`,
                "--env",
                `RIG_GYM_TOKEN=${inference.token}`,
                "--env",
                "RIG_MODEL=openai/gym",
                "--env",
                "RIG_PERMISSION_MODE=full_access",
                "--env",
                "RIG_PROVIDER=gym",
                "--volume",
                `${workspacePath}:/workspace`,
                "--workdir",
                "/workspace",
                imageId,
            ],
            {
                cols,
                cwd: repositoryRoot,
                env: process.env as Record<string, string>,
                name: "xterm-256color",
                rows,
            },
        );
        pty.onData((data) => startedGhostty.write(data));
        const startedGym = new Gym({
            containerName,
            ghostty: startedGhostty,
            inference,
            pty,
            workspacePath,
        });
        gym = startedGym;
        await Promise.race([
            startedGym.terminal.waitForText(
                options.startupText ?? "Ask Rig to do anything",
                options.timeoutMs ?? 20_000,
            ),
            startedGym.exit().then(async ({ exitCode, signal }) => {
                const snapshot = await startedGym.terminal.snapshot();
                throw new Error(
                    `Gym container exited before startup (code ${exitCode}, signal ${String(signal)}).\n\n${snapshot.text}`,
                );
            }),
        ]);
        return startedGym;
    } catch (error) {
        if (gym !== undefined) {
            await gym.dispose().catch(() => {});
        } else {
            ghostty?.close();
            await inference.stop().catch(() => {});
            await rm(workspacePath, { force: true, recursive: true });
        }
        throw error;
    }
}
