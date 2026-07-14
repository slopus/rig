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

export interface GetLocalServerPathsOptions {
    databasePath?: string;
    directory?: string;
}

export function getLocalServerPaths(
    uid = process.getuid?.() ?? 0,
    options: GetLocalServerPathsOptions = {},
): LocalServerPaths {
    const directory = options.directory ?? join(tmpdir(), `rig-${uid}`);
    return {
        databasePath: options.databasePath ?? getDefaultSessionDatabasePath(),
        directory,
        logPath: join(directory, "server.log"),
        registryPath: join(directory, "server.json"),
        socketPath: join(directory, "server.sock"),
        tokenPath: join(directory, "token"),
    };
}
