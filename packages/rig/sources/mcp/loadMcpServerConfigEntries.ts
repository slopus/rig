import { loadConfig } from "../config/loadConfig.js";
import type { LoadConfigOptions } from "../config/types.js";
import type { McpServerConfig, McpServerConfigEntry, McpServerConfigSource } from "./types.js";

export async function loadMcpServerConfigEntries(
    cwd: string,
    options: Omit<LoadConfigOptions, "cwd"> = {},
): Promise<readonly McpServerConfigEntry[]> {
    const loaded = await loadConfig({ ...options, cwd });
    const trustedEntries = new Map<string, McpServerConfigEntry>();
    const projectEntries = new Map<string, McpServerConfigEntry>();
    const trustedLayers: ReadonlyArray<
        readonly [Readonly<Record<string, McpServerConfig>> | undefined, McpServerConfigSource]
    > = [
        [loaded.sources.global.values.mcpServers, "global"],
        [loaded.sources.runtime.values.mcpServers, "runtime"],
    ];
    for (const [configs, source] of trustedLayers) {
        for (const [name, config] of Object.entries(configs ?? {})) {
            trustedEntries.set(name, { config, name, source });
        }
    }
    for (const [name, config] of Object.entries(loaded.sources.local.values.mcpServers ?? {})) {
        projectEntries.set(name, { config, name, source: "project" });
    }

    const entries = [...trustedEntries.values()].map(
        (entry): McpServerConfigEntry => ({
            ...entry,
            ...(projectEntries.has(entry.name) ? { projectShadowed: true } : {}),
        }),
    );
    for (const entry of projectEntries.values()) {
        if (!trustedEntries.has(entry.name)) entries.push(entry);
    }

    return entries;
}
