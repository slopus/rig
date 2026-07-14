import { posix } from "node:path";

import type { DockerEnvironment } from "./DockerEnvironment.js";
import { runDockerExec } from "./runDockerExec.js";

export async function resolveDockerPath(
    environment: DockerEnvironment,
    target: string,
): Promise<string> {
    if (!posix.isAbsolute(target)) {
        throw new Error(`Docker paths must be absolute before resolution: '${target}'.`);
    }
    const result = await runDockerExec(await environment.container(), [
        "/bin/sh",
        "-c",
        'target=$1; suffix=; while [ ! -e "$target" ] && [ ! -L "$target" ]; do [ "$target" = / ] && break; name=${target##*/}; suffix="/$name$suffix"; target=${target%/*}; [ -n "$target" ] || target=/; done; resolved=$(readlink -f "$target") || exit 1; printf "%s%s" "$resolved" "$suffix"',
        "rig",
        target,
    ]);
    if (result.exitCode !== 0 || result.stdout.length === 0) {
        throw new Error(`Could not resolve '${target}' in the Docker container.`);
    }
    return posix.normalize(result.stdout.toString("utf8"));
}
