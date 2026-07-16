import { join } from "node:path";

import { getRigHome } from "./getRigHome.js";

export function getDefaultGlobalConfigPath(
    env: NodeJS.ProcessEnv = process.env,
    homeDirectory?: string,
): string {
    return join(getRigHome(env, homeDirectory), "config.toml");
}
