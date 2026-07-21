import { query as createClaudeQuery, type Query } from "@anthropic-ai/claude-agent-sdk";

import type { ConfigProviders } from "../config/types.js";
import { createClaudeQuotaLoader } from "./createClaudeQuotaLoader.js";
import { createProviderQuotaCache } from "./createProviderQuotaCache.js";
import { fetchCodexProviderQuota } from "./fetchCodexProviderQuota.js";
import { fetchKimiProviderQuota } from "./fetchKimiProviderQuota.js";
import type { ProviderQuota } from "./providerQuota.js";

export interface ProviderQuotaService {
    get(providerId: string, options?: { fresh?: boolean }): Promise<ProviderQuota | undefined>;
}

export interface CreateProviderQuotaServiceOptions {
    createClaudeQuery?: (options: Parameters<typeof createClaudeQuery>[0]) => Query;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    loadClaudeQuota?: () => Promise<ProviderQuota>;
    loadCodexQuota?: () => Promise<ProviderQuota>;
    loadKimiQuota?: () => Promise<ProviderQuota>;
    now?: () => number;
    pathToClaudeCodeExecutable?: string;
    providers?: ConfigProviders;
}

export function createProviderQuotaService(
    options: CreateProviderQuotaServiceOptions,
): ProviderQuotaService {
    const env = options.env ?? process.env;
    const now = options.now ?? Date.now;
    const codex = createProviderQuotaCache(
        options.loadCodexQuota ??
            (() =>
                fetchCodexProviderQuota({
                    ...(env.RIG_CODEX_BASE_URL === undefined
                        ? {}
                        : { baseUrl: env.RIG_CODEX_BASE_URL }),
                    now,
                    env,
                })),
        { now },
    );
    const claudeByProviderId = new Map<string, ReturnType<typeof createProviderQuotaCache>>();
    const kimi = createProviderQuotaCache(
        options.loadKimiQuota ??
            (() =>
                fetchKimiProviderQuota({
                    ...(env.RIG_KIMI_BASE_URL === undefined
                        ? {}
                        : { baseUrl: env.RIG_KIMI_BASE_URL }),
                    now,
                    env,
                })),
        { now },
    );

    return {
        get(providerId, getOptions) {
            if (providerId === "codex") return codex.get(getOptions);
            const configuredProvider = options.providers?.[providerId];
            if (providerId === "claude" || configuredProvider?.type === "claude") {
                let cache = claudeByProviderId.get(providerId);
                if (cache === undefined) {
                    cache = createProviderQuotaCache(
                        options.loadClaudeQuota ??
                            createClaudeQuotaLoader({
                                ...(configuredProvider?.type === "claude"
                                    ? { config: configuredProvider }
                                    : {}),
                                ...(options.createClaudeQuery === undefined
                                    ? {}
                                    : { createClaudeQuery: options.createClaudeQuery }),
                                ...(options.pathToClaudeCodeExecutable === undefined
                                    ? {}
                                    : {
                                          pathToClaudeCodeExecutable:
                                              options.pathToClaudeCodeExecutable,
                                      }),
                                cwd: options.cwd,
                                env,
                                now,
                            }),
                        { now },
                    );
                    claudeByProviderId.set(providerId, cache);
                }
                return cache.get(getOptions);
            }
            if (providerId === "kimi") return kimi.get(getOptions);
            return Promise.resolve(undefined);
        },
    };
}
