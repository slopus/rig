import { posix } from "node:path";

import type Dockerode from "dockerode";

import { runDockerExec } from "./runDockerExec.js";

export interface PreparedDockerSandbox {
    bwrapPath: string;
}

export async function prepareDockerSandbox(
    container: Dockerode.Container,
): Promise<PreparedDockerSandbox> {
    const metadata = await runDockerExec(container, [
        "/bin/sh",
        "-c",
        'bwrap=$(command -v bwrap) || exit 20; readlink -f "$bwrap" || exit 21',
    ]);
    if (metadata.exitCode !== 0) throw dockerSandboxRequirementsError(metadata.stderr);

    const bwrapPath = metadata.stdout.toString("utf8").trim();
    if (!posix.isAbsolute(bwrapPath)) {
        throw dockerSandboxRequirementsError(metadata.stderr);
    }

    const probe = await runDockerExec(container, [
        bwrapPath,
        "--new-session",
        "--die-with-parent",
        "--unshare-net",
        "--ro-bind",
        "/",
        "/",
        "--dev",
        "/dev",
        "--unshare-pid",
        "--unshare-user",
        "--bind",
        "/proc",
        "/proc",
        "--",
        "/bin/sh",
        "-c",
        ":",
    ]);
    if (probe.exitCode !== 0) throw dockerSandboxRequirementsError(probe.stderr);

    return { bwrapPath };
}

function dockerSandboxRequirementsError(stderr: Buffer): Error {
    const detail = stderr.toString("utf8").trim();
    return new Error(
        "Restricted Docker commands require Bubblewrap and nested user namespaces. Install bubblewrap in the image; when connecting to an existing container, start it with '--security-opt seccomp=unconfined'." +
            (detail === "" ? "" : ` Docker reported: ${detail}`),
    );
}
