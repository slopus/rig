import { query as createClaudeQuery, type Query } from "@anthropic-ai/claude-agent-sdk";
import {
    createClaudeQuotaLoader,
    createProviderQuotaCache,
    fetchCodexProviderQuota,
    type ProviderQuota,
} from "@slopus/rig-providers";

import type { ConfigProviders } from "../config/types.js";

export interface ProviderQuotaService {
    get(providerId: string, options?: { fresh?: boolean }): Promise<ProviderQuota | undefined>;
}

export interface CreateProviderQuotaServiceOptions {
    createClaudeQuery?: (options: Parameters<typeof createClaudeQuery>[0]) => Query;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    loadClaudeQuota?: () => Promise<ProviderQuota>;
    loadCodexQuota?: () => Promise<ProviderQuota>;
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
                                    ? {
                                          ...(configuredProvider.configDir === undefined
                                              ? {}
                                              : { configDir: configuredProvider.configDir }),
                                          ...(configuredProvider.executable === undefined
                                              ? {}
                                              : { executable: configuredProvider.executable }),
                                          ...(configuredProvider.oauthToken === undefined
                                              ? {}
                                              : { oauthToken: configuredProvider.oauthToken }),
                                      }
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
            return Promise.resolve(undefined);
        },
    };
}
