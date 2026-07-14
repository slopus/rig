import type { DaemonRestartRequest } from "../client/index.js";

export function formatDaemonRestartMessage(request: DaemonRestartRequest): string {
    if (request.currentIdentity.developmentBuildId !== undefined) {
        return "This workspace's development code changed after its daemon started. Restart the daemon to load the current code.";
    }
    if (request.runningIdentity === undefined) {
        return "The running daemon was started by an older Rig version. Restart the daemon to use this CLI.";
    }
    return `The running daemon uses Rig ${request.runningIdentity.version}, but this CLI is Rig ${request.currentIdentity.version}. Restart the daemon to use this CLI.`;
}
