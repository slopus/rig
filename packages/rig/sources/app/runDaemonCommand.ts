import {
    ensureLocalProtocolServer,
    ProtocolHttpClient,
    readTokenIfPresent,
} from "../client/index.js";
import { getEnvironmentLocalServerPaths } from "../server/index.js";

export type DaemonCommand = "start" | "stop" | "status";

export async function runDaemonCommand(command: DaemonCommand): Promise<void> {
    if (command === "start") {
        const connection = await ensureLocalProtocolServer({
            confirmRestart: async () => true,
        });
        console.log(`Daemon is running at ${connection.paths.socketPath}`);
        return;
    }

    const connection = await connectToExistingDaemon();
    if (command === "status") {
        if (connection === undefined) {
            console.log("Daemon is not running.");
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
        return health.healthy && health.ready ? { client } : undefined;
    } catch {
        return undefined;
    }
}
