import { query as defaultClaudeQuery } from "@anthropic-ai/claude-agent-sdk";

import type { ConfigClaudeProvider } from "../config/types.js";
import { CLAUDE_SDK_PRIVACY_ENVIRONMENT } from "./claudeSdkPrivacyEnvironment.js";
import { createConfiguredClaudeEnvironment } from "./createConfiguredClaudeEnvironment.js";
import { fetchClaudeProviderQuota } from "./fetchClaudeProviderQuota.js";
import { idleClaudeSdkPrompt } from "./idleClaudeSdkPrompt.js";
import type { ProviderQuota } from "./providerQuota.js";
import { resolveClaudeCodeExecutablePath } from "./resolveClaudeCodeExecutablePath.js";
import { unavailableProviderQuota } from "./unavailableProviderQuota.js";

export function createClaudeQuotaLoader(options: {
    config?: ConfigClaudeProvider;
    createClaudeQuery?: typeof defaultClaudeQuery;
    cwd: string;
    env: NodeJS.ProcessEnv;
    now: () => number;
    pathToClaudeCodeExecutable?: string;
}): () => Promise<ProviderQuota> {
    const configuredEnv =
        options.config === undefined
            ? options.env
            : createConfiguredClaudeEnvironment(options.config, options.env);

    return async () => {
        try {
            const pathToClaudeCodeExecutable =
                options.config?.executable ??
                options.pathToClaudeCodeExecutable ??
                configuredEnv.RIG_CLAUDE_CODE_EXECUTABLE ??
                resolveClaudeCodeExecutablePath();
            const query = (options.createClaudeQuery ?? defaultClaudeQuery)({
                prompt: idleClaudeSdkPrompt(),
                options: {
                    cwd: options.cwd,
                    env: {
                        ...configuredEnv,
                        ...CLAUDE_SDK_PRIVACY_ENVIRONMENT,
                    },
                    pathToClaudeCodeExecutable,
                    persistSession: false,
                    settings: { env: CLAUDE_SDK_PRIVACY_ENVIRONMENT },
                    settingSources: [],
                },
            });
            return fetchClaudeProviderQuota(query, { now: options.now });
        } catch {
            return unavailableProviderQuota("claude", options.now());
        }
    };
}
