import { query as createClaudeQuery, type Query } from "@anthropic-ai/claude-agent-sdk";

import { createProviderQuotaCache } from "./createProviderQuotaCache.js";
import { fetchClaudeProviderQuota } from "./fetchClaudeProviderQuota.js";
import { fetchCodexProviderQuota } from "./fetchCodexProviderQuota.js";
import { idleClaudeSdkPrompt } from "./idleClaudeSdkPrompt.js";
import type { ProviderQuota } from "./providerQuota.js";
import { resolveClaudeCodeExecutablePath } from "./resolveClaudeCodeExecutablePath.js";
import { unavailableProviderQuota } from "./unavailableProviderQuota.js";

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
                })),
        { now },
    );
    const claude = createProviderQuotaCache(
        options.loadClaudeQuota ??
            (async () => {
                try {
                    const query = (options.createClaudeQuery ?? createClaudeQuery)({
                        prompt: idleClaudeSdkPrompt(),
                        options: {
                            cwd: options.cwd,
                            pathToClaudeCodeExecutable:
                                options.pathToClaudeCodeExecutable ??
                                resolveClaudeCodeExecutablePath(),
                            persistSession: false,
                            settingSources: [],
                        },
                    });
                    return fetchClaudeProviderQuota(query, { now });
                } catch {
                    return unavailableProviderQuota("claude-sdk", now());
                }
            }),
        { now },
    );

    return {
        get(providerId, getOptions) {
            if (providerId === "codex") return codex.get(getOptions);
            if (providerId === "claude-sdk") return claude.get(getOptions);
            return Promise.resolve(undefined);
        },
    };
}
