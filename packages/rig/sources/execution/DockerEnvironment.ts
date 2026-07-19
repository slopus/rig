import Dockerode from "dockerode";

import { errorToMessage } from "../errorToMessage.js";
import type { DockerExecutionConfig } from "./DockerExecutionConfig.js";
import { isDockerNotFoundError } from "./isDockerNotFoundError.js";

const DEFAULT_DOCKER_SOCKET = "/var/run/docker.sock";

export class DockerEnvironment {
    readonly config: DockerExecutionConfig;
    readonly #docker: Dockerode;
    readonly #sessionId: string;
    #containerPromise: Promise<Dockerode.Container> | undefined;

    constructor(
        config: DockerExecutionConfig,
        sessionId: string,
        docker: Dockerode = new Dockerode({
            socketPath: config.socketPath ?? DEFAULT_DOCKER_SOCKET,
        }),
    ) {
        this.config = config;
        this.#sessionId = sessionId;
        this.#docker = docker;
    }

    container(): Promise<Dockerode.Container> {
        this.#containerPromise ??= this.#resolveContainer().catch((error: unknown) => {
            this.#containerPromise = undefined;
            throw error;
        });
        return this.#containerPromise;
    }

    async #resolveContainer(): Promise<Dockerode.Container> {
        if (this.config.container !== undefined) {
            const container = this.#docker.getContainer(this.config.container);
            const details = await container.inspect().catch((error: unknown) => {
                if (isDockerNotFoundError(error)) {
                    throw new Error(
                        `Docker container '${this.config.container}' was not found. Start it or update your Rig Docker configuration.`,
                    );
                }
                throw error;
            });
            if (!details.State.Running) {
                throw new Error(
                    `Docker container '${this.config.container}' is not running. Start it before sending a message.`,
                );
            }
            return container;
        }

        const image = this.config.image;
        if (image === undefined) throw new Error("Docker execution requires a container or image.");
        const name = this.config.name ?? `rig-${this.#sessionId}`;
        const existing = this.#docker.getContainer(name);
        const details = await existing.inspect().catch((error: unknown) => {
            if (isDockerNotFoundError(error)) return undefined;
            throw error;
        });
        if (details !== undefined) {
            if (
                details.Config.Labels?.["dev.rig.managed"] !== "true" ||
                (this.config.name === undefined &&
                    details.Config.Labels?.["dev.rig.session"] !== this.#sessionId)
            ) {
                throw new Error(
                    `Docker container name '${name}' is already in use by another container. Choose a different Docker container name.`,
                );
            }
            if (!details.State.Running) await existing.start();
            return existing;
        }

        const container = await this.#docker
            .createContainer({
                name,
                Image: image,
                Entrypoint: ["/bin/sh", "-c"],
                Cmd: ["trap : TERM INT; while :; do sleep 2073600; done"],
                Env: Object.entries(this.config.environment ?? {}).map(
                    ([key, value]) => `${key}=${value}`,
                ),
                Labels: {
                    "dev.rig.managed": "true",
                    "dev.rig.session": this.#sessionId,
                },
                OpenStdin: false,
                Tty: false,
                WorkingDir: this.config.workingDirectory,
                HostConfig: {
                    Mounts: (this.config.mounts ?? []).map((mount) => ({
                        Type: "bind" as const,
                        Source: mount.source,
                        Target: mount.target,
                        ReadOnly: mount.readOnly ?? false,
                    })),
                    // Restricted commands create their own user, PID, mount, and network
                    // namespaces with Bubblewrap. Docker's default seccomp profile blocks
                    // those unprivileged namespace operations before Bubblewrap can apply
                    // the narrower command boundary.
                    SecurityOpt: ["seccomp=unconfined"],
                },
            })
            .catch((error: unknown) => {
                throw new Error(
                    `Could not create a Docker container from local image '${image}'. Make sure the image exists and the mount paths are available: ${errorToMessage(error)}`,
                );
            });
        await container.start().catch(async (error: unknown) => {
            await container.remove({ force: true }).catch(() => undefined);
            throw new Error(`Could not start Docker image '${image}': ${errorToMessage(error)}`);
        });
        return container;
    }
}
