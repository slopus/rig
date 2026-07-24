import {
    ensureLocalProtocolServer,
    ProtocolHttpClient,
    readTokenIfPresent,
    stopLocalProtocolServer,
} from "../client/index.js";
import { getEnvironmentLocalServerPaths } from "../server/index.js";
import type { HealthResponse } from "../protocol/index.js";

export type DaemonCommand = "reload" | "start" | "stop" | "status";

export async function runDaemonCommand(command: DaemonCommand): Promise<void> {
    if (command === "start") {
        const connection = await ensureLocalProtocolServer({
            confirmRestart: async () => true,
        });
        console.log(`Daemon is running at ${connection.paths.socketPath}`);
        return;
    }

    const connection = await connectToExistingDaemon();
    if (command === "reload") {
        if (connection !== undefined) {
            await stopLocalProtocolServer(connection.client);
        }
        const reloaded = await ensureLocalProtocolServer({
            confirmRestart: async () => true,
        });
        console.log(`Daemon is running at ${reloaded.paths.socketPath}`);
        return;
    }

    if (command === "status") {
        if (connection === undefined) {
            console.log("Daemon is not running.");
            return;
        }
        if (connection.health.status === "error") {
            console.log(`Daemon could not start: ${connection.health.error}`);
            return;
        }
        if (connection.health.status === "starting") {
            console.log(`Daemon is starting at ${connection.client.socketPath}`);
            return;
        }
        console.log(`Daemon is running at ${connection.client.socketPath}`);
        return;
    }

    if (connection === undefined) {
        console.log("Daemon is not running.");
        return;
    }
    await connection.client.shutdown();
    console.log("Daemon is stopping.");
}

async function connectToExistingDaemon(): Promise<
    | {
          client: ProtocolHttpClient;
          health: HealthResponse;
      }
    | undefined
> {
    const paths = getEnvironmentLocalServerPaths();
    const token = await readTokenIfPresent(paths.tokenPath);
    if (token === undefined) {
        return undefined;
    }

    const client = new ProtocolHttpClient({
        socketPath: paths.socketPath,
        token,
    });
    try {
        const health = await client.health();
        return { client, health };
    } catch {
        return undefined;
    }
}
