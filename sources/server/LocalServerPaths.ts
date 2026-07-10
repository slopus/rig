import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDefaultSessionDatabasePath } from "./getDefaultSessionDatabasePath.js";

export interface LocalServerPaths {
    databasePath: string;
    directory: string;
    logPath: string;
    registryPath: string;
    socketPath: string;
    tokenPath: string;
}

export function getLocalServerPaths(uid = process.getuid?.() ?? 0): LocalServerPaths {
    const directory = join(tmpdir(), `rig-${uid}`);
    return {
        databasePath: getDefaultSessionDatabasePath(),
        directory,
        logPath: join(directory, "server.log"),
        registryPath: join(directory, "server.json"),
        socketPath: join(directory, "server.sock"),
        tokenPath: join(directory, "token"),
    };
}
