import {
    ClaudeApiKeyCredential,
    ClaudeAuthTokenCredential,
    ClaudeOAuthCredential,
    ClaudeProvider,
} from "@slopus/rig-providers";
import { builtinModelProfiles, type ExecutorProvider } from "@slopus/rig-execution";

import type { AgentContext } from "../agent/context/AgentContext.js";
import type { ConfigClaudeProvider } from "../config/types.js";
import { createConfiguredClaudeEnvironment } from "./createConfiguredClaudeEnvironment.js";

export function claudeExecution(options: {
    agentContext: AgentContext;
    config: ConfigClaudeProvider;
    env: NodeJS.ProcessEnv;
    id: string;
    sessionId?: string;
}): ExecutorProvider {
    const executable = options.config.executable ?? options.env.RIG_CLAUDE_CODE_EXECUTABLE;
    const environment = createConfiguredClaudeEnvironment(options.config, options.env);
    const pathToClaudeCodeExecutable = executable;
    return {
        id: options.id,
        extendProfilePromptContext: (context) => ({
            ...context,
            ...(environment.CLAUDE_CONFIG_DIR === undefined
                ? {}
                : { claudeConfigDirectory: environment.CLAUDE_CONFIG_DIR }),
            ...(environment.SHELL === undefined ? {} : { shell: environment.SHELL }),
        }),
        profiles: builtinModelProfiles(options.id, "claude"),
        sessionId: options.sessionId ?? options.id,
        native: async () => {
            const credential =
                (options.config.oauthToken === undefined
                    ? null
                    : await ClaudeOAuthCredential.tryLoad({
                          env: environment,
                          oauthToken: options.config.oauthToken,
                      })) ??
                (await ClaudeApiKeyCredential.tryLoad({ env: environment })) ??
                (await ClaudeAuthTokenCredential.tryLoad({ env: environment })) ??
                (await ClaudeOAuthCredential.tryLoad({
                    env: environment,
                    ...(options.config.configDir === undefined
                        ? {}
                        : { configDir: options.config.configDir }),
                }));
            if (credential === null) {
                throw new Error(
                    "Claude authentication is unavailable. Sign in with Claude Code or configure a credential.",
                );
            }
            return new ClaudeProvider({
                credential,
                cwd: options.agentContext.fs.cwd,
                env: environment,
                ...(pathToClaudeCodeExecutable === undefined ? {} : { pathToClaudeCodeExecutable }),
            });
        },
    };
}
