import type { ProtocolHttpClient } from "./ProtocolHttpClient.js";
import { errorToMessage } from "../errorToMessage.js";
import { waitForSocketRemoval } from "./waitForSocketRemoval.js";

const DAEMON_SHUTDOWN_TIMEOUT_MS = 30_000;

export async function stopLocalProtocolServer(client: ProtocolHttpClient): Promise<void> {
    try {
        await client.shutdown();
    } catch (error) {
        if (await waitForSocketRemoval(client.socketPath, DAEMON_SHUTDOWN_TIMEOUT_MS)) {
            return;
        }
        throw new Error(`Could not stop the existing local daemon: ${errorToMessage(error)}`);
    }
    if (!(await waitForSocketRemoval(client.socketPath, DAEMON_SHUTDOWN_TIMEOUT_MS))) {
        throw new Error(
            "Timed out while waiting for the existing local daemon to release its socket. Rig did not start a replacement.",
        );
    }
}
