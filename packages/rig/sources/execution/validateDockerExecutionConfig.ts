import type { DockerExecutionConfig } from "./DockerExecutionConfig.js";

export function validateDockerExecutionConfig(
    config: unknown,
): asserts config is DockerExecutionConfig {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
        throw new Error("Docker environment settings must be an object.");
    }
    const candidate = config as Partial<DockerExecutionConfig>;
    const containerValue =
        typeof candidate.container === "string" ? candidate.container.trim() : undefined;
    const imageValue = typeof candidate.image === "string" ? candidate.image.trim() : undefined;
    const container = containerValue === "" ? undefined : containerValue;
    const image = imageValue === "" ? undefined : imageValue;
    if ((container === undefined) === (image === undefined)) {
        throw new Error("Choose either a running Docker container or a local Docker image.");
    }
    if (
        typeof candidate.workingDirectory !== "string" ||
        !candidate.workingDirectory.startsWith("/")
    ) {
        throw new Error("The Docker working directory must be an absolute container path.");
    }
    if (
        container !== undefined &&
        (candidate.environment !== undefined ||
            candidate.mounts !== undefined ||
            candidate.name !== undefined)
    ) {
        throw new Error(
            "Environment variables, mounts, and a managed name can only be used with a Docker image.",
        );
    }
    if (candidate.mounts !== undefined && !Array.isArray(candidate.mounts)) {
        throw new Error("Docker mounts must be an array.");
    }
    for (const mount of candidate.mounts ?? []) {
        if (
            typeof mount !== "object" ||
            mount === null ||
            typeof mount.source !== "string" ||
            mount.source.trim().length === 0 ||
            typeof mount.target !== "string" ||
            !mount.target.startsWith("/")
        ) {
            throw new Error(
                "Each Docker mount needs a source and an absolute container target path.",
            );
        }
        if (mount.readOnly !== undefined && typeof mount.readOnly !== "boolean") {
            throw new Error("Docker mount readOnly values must be true or false.");
        }
    }
    if (
        candidate.environment !== undefined &&
        (typeof candidate.environment !== "object" ||
            candidate.environment === null ||
            Array.isArray(candidate.environment) ||
            Object.values(candidate.environment).some((value) => typeof value !== "string"))
    ) {
        throw new Error("Docker environment variables must contain string values.");
    }
    if (
        candidate.socketPath !== undefined &&
        (typeof candidate.socketPath !== "string" || candidate.socketPath.trim().length === 0)
    ) {
        throw new Error("The Docker socket path must be a non-empty string.");
    }
    if (
        candidate.name !== undefined &&
        (typeof candidate.name !== "string" || candidate.name.trim().length === 0)
    ) {
        throw new Error("The managed Docker container name must be a non-empty string.");
    }
}
