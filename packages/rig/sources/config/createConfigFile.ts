import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify } from "smol-toml";

import { DEFAULT_RIG_CONFIG } from "./defaultConfig.js";
import { serializeMcpServers } from "./serializeMcpServers.js";
import { serializeProviders } from "./serializeProviders.js";
import type { RigConfig } from "./types.js";

export async function createConfigFile(
    path: string,
    config: RigConfig = DEFAULT_RIG_CONFIG,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
        path,
        stringify({
            defaults: {
                model: config.defaults.modelId,
                permission_mode: config.defaults.permissionMode,
                ...(config.defaults.providerId !== undefined
                    ? { provider: config.defaults.providerId }
                    : {}),
                ...(config.defaults.effort !== undefined ? { effort: config.defaults.effort } : {}),
                ...(config.defaults.instructions !== undefined
                    ? { instructions: config.defaults.instructions }
                    : {}),
                ...(config.defaults.serviceTier !== undefined
                    ? { service_tier: config.defaults.serviceTier }
                    : {}),
            },
            settings: {
                durable_global_event_queue: config.settings.durableGlobalEventQueue,
                show_reasoning: config.settings.showReasoning,
                show_usage: config.settings.showUsage,
            },
            features: {
                workflows: config.features.workflows,
            },
            providers: serializeProviders(config.providers),
            theme: config.theme,
            ...(config.docker === undefined
                ? {}
                : {
                      docker: {
                          ...(config.docker.container === undefined
                              ? {}
                              : { container: config.docker.container }),
                          ...(config.docker.image === undefined
                              ? {}
                              : { image: config.docker.image }),
                          workdir: config.docker.workingDirectory,
                          ...(config.docker.name === undefined ? {} : { name: config.docker.name }),
                          ...(config.docker.socketPath === undefined
                              ? {}
                              : { socket_path: config.docker.socketPath }),
                          ...(config.docker.environment === undefined
                              ? {}
                              : { env: config.docker.environment }),
                          ...(config.docker.mounts === undefined
                              ? {}
                              : {
                                    mounts: config.docker.mounts.map((mount) => ({
                                        source: mount.source,
                                        target: mount.target,
                                        ...(mount.readOnly === undefined
                                            ? {}
                                            : { read_only: mount.readOnly }),
                                    })),
                                }),
                      },
                  }),
            ...(Object.keys(config.mcpServers).length > 0
                ? { mcp_servers: serializeMcpServers(config.mcpServers) }
                : {}),
        }),
        { encoding: "utf8", flag: "wx" },
    );
}
