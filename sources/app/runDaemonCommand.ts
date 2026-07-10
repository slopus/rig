import {
    ensureLocalProtocolServer,
    ProtocolHttpClient,
    readTokenIfPresent,
} from "../client/index.js";
import { getLocalServerPaths } from "../server/index.js";

export type DaemonCommand = "start" | "stop" | "status";

export async function runDaemonCommand(command: DaemonCommand): Promise<void> {
    if (command === "start") {
        const connection = await ensureLocalProtocolServer();
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

function getEnvironmentLocalServerPaths(): ReturnType<typeof getLocalServerPaths> {
    const paths = getLocalServerPaths();
    return {
        ...paths,
        socketPath: process.env.RIG_SERVER_SOCKET_PATH ?? paths.socketPath,
        tokenPath: process.env.RIG_SERVER_TOKEN_PATH ?? paths.tokenPath,
    };
}
