import { query as defaultClaudeQuery } from "@anthropic-ai/claude-agent-sdk";

import type { ProviderQuota } from "@/core/ProviderQuota.js";
import { unavailableProviderQuota } from "@/core/unavailableProviderQuota.js";
import { CLAUDE_SDK_PRIVACY_ENVIRONMENT } from "@/vendors/claude/claudeSdkPrivacyEnvironment.js";
import { fetchClaudeProviderQuota } from "@/vendors/claude/fetchClaudeProviderQuota.js";
import { idleClaudeSdkPrompt } from "@/vendors/claude/idleClaudeSdkPrompt.js";
import { resolveClaudeCodeExecutablePath } from "@/vendors/claude/resolveClaudeCodeExecutablePath.js";

export interface CreateClaudeQuotaLoaderOptions {
    configDir?: string;
    createClaudeQuery?: typeof defaultClaudeQuery;
    cwd: string;
    env: NodeJS.ProcessEnv;
    executable?: string;
    now: () => number;
    oauthToken?: string;
    pathToClaudeCodeExecutable?: string;
}

export function createClaudeQuotaLoader(
    options: CreateClaudeQuotaLoaderOptions,
): () => Promise<ProviderQuota> {
    const configuredEnv = createClaudeQuotaEnvironment(options);

    return async () => {
        try {
            const pathToClaudeCodeExecutable =
                options.executable ??
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

function createClaudeQuotaEnvironment(
    options: Pick<CreateClaudeQuotaLoaderOptions, "configDir" | "env" | "oauthToken">,
): NodeJS.ProcessEnv {
    const configured: NodeJS.ProcessEnv = {
        ...options.env,
        ...(options.configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: options.configDir }),
        ...(options.oauthToken === undefined
            ? {}
            : { CLAUDE_CODE_OAUTH_TOKEN: options.oauthToken }),
    };
    if (options.oauthToken !== undefined) {
        delete configured.ANTHROPIC_API_KEY;
        delete configured.ANTHROPIC_AUTH_TOKEN;
        delete configured.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR;
        delete configured.CLAUDE_CODE_USE_BEDROCK;
        delete configured.CLAUDE_CODE_USE_FOUNDRY;
        delete configured.CLAUDE_CODE_USE_VERTEX;
    }
    return configured;
}
