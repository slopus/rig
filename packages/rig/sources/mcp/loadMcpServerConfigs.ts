import type { LoadConfigOptions } from "../config/types.js";
import { loadMcpServerConfigEntries } from "./loadMcpServerConfigEntries.js";
import type { McpServerConfig } from "./types.js";

export async function loadMcpServerConfigs(
    cwd: string,
    options: Omit<LoadConfigOptions, "cwd"> = {},
): Promise<Readonly<Record<string, McpServerConfig>>> {
    const entries = await loadMcpServerConfigEntries(cwd, options);
    return Object.fromEntries(entries.map((entry) => [entry.name, entry.config]));
}
