import type { DaemonIdentity } from "../protocol/index.js";

export function daemonIdentitiesMatch(
    current: DaemonIdentity,
    running: DaemonIdentity | undefined,
): boolean {
    return (
        running !== undefined &&
        current.version === running.version &&
        current.developmentBuildId === running.developmentBuildId
    );
}
