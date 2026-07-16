import { join } from "node:path";

import { getRigHome } from "../config/getRigHome.js";

export function getDefaultSessionDatabasePath(
    env: NodeJS.ProcessEnv = process.env,
    homeDirectory?: string,
): string {
    return join(getRigHome(env, homeDirectory), "sessions.sqlite");
}
