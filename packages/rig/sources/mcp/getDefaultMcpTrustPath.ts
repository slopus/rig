import { join } from "node:path";

import { getRigHome } from "../config/getRigHome.js";

export function getDefaultMcpTrustPath(
    environment: NodeJS.ProcessEnv = process.env,
    homeDirectory?: string,
): string {
    return join(getRigHome(environment, homeDirectory), "mcp-trust.json");
}
