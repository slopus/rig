import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "@lydell/node-pty";

import { buildGymImage } from "./buildGymImage.js";
import { createFixtureWorkspace } from "./createFixtureWorkspace.js";
import { GhosttyTerminal } from "./GhosttyTerminal.js";
import { Gym } from "./Gym.js";
import { InterceptingHttpProxy } from "./InterceptingHttpProxy.js";
import { MockInferenceServer } from "./MockInferenceServer.js";
import type { GymOptions } from "./types.js";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_IMAGE = process.env.RIG_GYM_IMAGE ?? "rig-gym:local";

export async function createGym(options: GymOptions): Promise<Gym> {
    const cols = options.cols ?? 100;
    const rows = options.rows ?? 32;
    const image = options.image ?? DEFAULT_IMAGE;
    const workspacePath = await createFixtureWorkspace(options.files);
    let homePath: string | undefined;
    try {
        if (options.homeFiles !== undefined) {
            homePath = await createFixtureWorkspace(options.homeFiles);
        }
    } catch (error) {
        await rm(workspacePath, { force: true, recursive: true });
        throw error;
    }
    const inference = new MockInferenceServer(options.inference ?? []);
    const httpProxy =
        options.httpProxy === undefined
            ? undefined
            : new InterceptingHttpProxy(
                  options.httpProxy === true ? undefined : options.httpProxy.handler,
              );
    const containerName = `rig-gym-${randomUUID()}`;
    let ghostty: GhosttyTerminal | undefined;
    let gym: Gym | undefined;
    try {
        const startedGhostty = await GhosttyTerminal.create(cols, rows);
        ghostty = startedGhostty;
        const [imageId] = await Promise.all([
            buildGymImage(image, repositoryRoot),
            inference.start(),
            httpProxy?.start(),
        ]);
        const providerId = options.providerId ?? "gym";
        const modelId = options.modelId ?? defaultModelId(providerId);
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
                "--security-opt",
                "seccomp=unconfined",
                "--add-host",
                "host.docker.internal:host-gateway",
                "--env",
                `RIG_GYM_INFERENCE_URL=${inference.url}`,
                "--env",
                `RIG_GYM_TOKEN=${inference.token}`,
                ...(options.contextWindow === undefined
                    ? []
                    : ["--env", `RIG_GYM_CONTEXT_WINDOW=${options.contextWindow}`]),
                "--env",
                "RIG_GYM_OUTER_ISOLATION=docker",
                "--env",
                `RIG_MODEL=${modelId}`,
                ...(options.permissionMode === "from_config"
                    ? []
                    : ["--env", `RIG_PERMISSION_MODE=${options.permissionMode ?? "full_access"}`]),
                "--env",
                `RIG_PROVIDER=${providerId}`,
                ...environmentArguments(options.environment, httpProxy?.url),
                ...(httpProxy === undefined
                    ? []
                    : [
                          "--env",
                          `HTTP_PROXY=${httpProxy.url}`,
                          "--env",
                          `http_proxy=${httpProxy.url}`,
                          "--env",
                          `HTTPS_PROXY=${httpProxy.url}`,
                          "--env",
                          `https_proxy=${httpProxy.url}`,
                          "--env",
                          "NODE_USE_ENV_PROXY=1",
                      ]),
                ...(options.entrypoint === undefined
                    ? []
                    : ["--entrypoint", options.entrypoint[0]]),
                "--volume",
                `${workspacePath}:/workspace`,
                ...(options.dockerSocket === true
                    ? [
                          "--group-add",
                          "0",
                          "--group-add",
                          String(statSync("/var/run/docker.sock").gid),
                          "--volume",
                          "/var/run/docker.sock:/var/run/docker.sock",
                      ]
                    : []),
                ...(homePath === undefined ? [] : ["--volume", `${homePath}:/home/rig`]),
                "--workdir",
                "/workspace",
                imageId,
                ...(options.entrypoint?.slice(1) ?? []),
                ...(options.args ?? []),
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
        startedGhostty.onPtyWrite((data) => pty.write(data));
        const startedGym = new Gym({
            containerName,
            ghostty: startedGhostty,
            ...(homePath === undefined ? {} : { homePath }),
            ...(httpProxy === undefined ? {} : { httpProxy }),
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
            await Promise.all([
                inference.stop().catch(() => {}),
                httpProxy?.stop().catch(() => {}),
            ]);
            await Promise.all([
                ...(homePath === undefined ? [] : [rm(homePath, { force: true, recursive: true })]),
                rm(workspacePath, { force: true, recursive: true }),
            ]);
        }
        throw error;
    }
}

function defaultModelId(providerId: "bedrock" | "claude-sdk" | "codex" | "gym"): string {
    if (providerId === "bedrock") return "openai/gpt-5.5";
    if (providerId === "claude-sdk") return "anthropic/sonnet-4-6";
    if (providerId === "codex") return "openai/gpt-5.4";
    return "openai/gym";
}

function environmentArguments(
    environment: Readonly<Record<string, string>> | undefined,
    httpProxyUrl?: string,
): string[] {
    if (environment === undefined) return [];
    return Object.entries(environment).flatMap(([name, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
            throw new Error(`Invalid Gym environment variable name '${name}'.`);
        }
        const expandedValue =
            httpProxyUrl === undefined
                ? value
                : value.replaceAll("{{HTTP_PROXY_URL}}", httpProxyUrl);
        return ["--env", `${name}=${expandedValue}`];
    });
}
