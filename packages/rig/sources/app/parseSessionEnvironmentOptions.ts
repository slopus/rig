import type { DockerExecutionConfig, DockerMountConfig } from "../execution/index.js";

export interface ParsedSessionEnvironmentOptions {
    debug?: boolean;
    docker?: DockerExecutionConfig | null;
    remaining: readonly string[];
}

export function parseSessionEnvironmentOptions(
    args: readonly string[],
): ParsedSessionEnvironmentOptions {
    const remaining: string[] = [];
    const environment: Record<string, string> = {};
    const mounts: DockerMountConfig[] = [];
    let mode: "container" | "image" | "local" | undefined;
    let reference: string | undefined;
    let name: string | undefined;
    let socketPath: string | undefined;
    let workingDirectory = "/workspace";
    let debug = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--") {
            remaining.push(...args.slice(index));
            break;
        } else if (argument === "--debug") {
            debug = true;
        } else if (argument === "--local") {
            selectMode("local");
        } else if (argument === "--docker-container") {
            selectMode("container");
            reference = requiredValue(args, ++index, argument);
        } else if (argument === "--docker-image") {
            selectMode("image");
            reference = requiredValue(args, ++index, argument);
        } else if (argument === "--docker-workdir") {
            workingDirectory = requiredValue(args, ++index, argument);
        } else if (argument === "--docker-socket") {
            socketPath = requiredValue(args, ++index, argument);
        } else if (argument === "--docker-name") {
            name = requiredValue(args, ++index, argument);
        } else if (argument === "--docker-env") {
            const entry = requiredValue(args, ++index, argument);
            const separator = entry.indexOf("=");
            const key = separator < 0 ? "" : entry.slice(0, separator);
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                throw new Error("--docker-env must use NAME=value.");
            }
            environment[key] = entry.slice(separator + 1);
        } else if (argument === "--docker-mount") {
            mounts.push(parseMount(requiredValue(args, ++index, argument)));
        } else if (argument !== undefined) {
            remaining.push(argument);
        }
    }

    const hasDockerOptions =
        name !== undefined ||
        socketPath !== undefined ||
        workingDirectory !== "/workspace" ||
        mounts.length > 0 ||
        Object.keys(environment).length > 0;
    if (mode === undefined) {
        if (hasDockerOptions) {
            throw new Error("Choose --docker-container or --docker-image with Docker options.");
        }
        return { ...(debug ? { debug: true } : {}), remaining };
    }
    if (mode === "local") {
        if (hasDockerOptions) throw new Error("--local cannot be combined with Docker options.");
        return { ...(debug ? { debug: true } : {}), docker: null, remaining };
    }
    if (reference === undefined) throw new Error("A Docker container or image is required.");
    if (!workingDirectory.startsWith("/")) {
        throw new Error("--docker-workdir must be an absolute container path.");
    }
    if (
        mode === "container" &&
        (name !== undefined || mounts.length > 0 || Object.keys(environment).length > 0)
    ) {
        throw new Error(
            "--docker-name, --docker-env, and --docker-mount can only be used with --docker-image.",
        );
    }
    return {
        ...(debug ? { debug: true } : {}),
        docker: {
            ...(mode === "container" ? { container: reference } : { image: reference }),
            ...(name === undefined ? {} : { name }),
            ...(socketPath === undefined ? {} : { socketPath }),
            ...(mounts.length === 0 ? {} : { mounts }),
            ...(Object.keys(environment).length === 0 ? {} : { environment }),
            workingDirectory,
        },
        remaining,
    };

    function selectMode(nextMode: typeof mode): void {
        if (mode !== undefined && mode !== nextMode) {
            throw new Error("Choose one of --local, --docker-container, or --docker-image.");
        }
        mode = nextMode;
    }
}

function parseMount(value: string): DockerMountConfig {
    const readOnly = value.endsWith(":ro");
    const withoutMode = readOnly ? value.slice(0, -3) : value;
    const separator = withoutMode.indexOf(":");
    const source = separator < 0 ? "" : withoutMode.slice(0, separator);
    const target = separator < 0 ? "" : withoutMode.slice(separator + 1);
    if (source.length === 0 || !target.startsWith("/")) {
        throw new Error(
            "--docker-mount must use /host/path:/container/path or append :ro for read-only.",
        );
    }
    return { source, target, ...(readOnly ? { readOnly: true } : {}) };
}

function requiredValue(args: readonly string[], index: number, option: string): string {
    const value = args[index];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`${option} requires a value.`);
    }
    return value;
}
