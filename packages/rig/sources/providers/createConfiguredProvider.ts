import type { AgentContext } from "../agent/context/AgentContext.js";
import type { ConfigProvider } from "../config/types.js";
import { createConfiguredBedrockProvider } from "./createConfiguredBedrockProvider.js";
import { createConfiguredClaudeProvider } from "./createConfiguredClaudeProvider.js";
import { createConfiguredCodexProvider } from "./createConfiguredCodexProvider.js";
import { createConfiguredGrokProvider } from "./createConfiguredGrokProvider.js";
import { createConfiguredKimiProvider } from "./createConfiguredKimiProvider.js";
import { filterConfiguredProviderModels } from "./filterConfiguredProviderModels.js";
import type { Provider } from "./types.js";

export type ConfiguredProviderResult =
    | { status: "available"; provider: Provider }
    | { status: "missing_credential"; variable: string };

export function createConfiguredProvider(options: {
    agentContext: AgentContext;
    allowEmptyModels?: boolean;
    apiKey?: string;
    config: ConfigProvider;
    env: NodeJS.ProcessEnv;
    id: string;
    sessionId?: string;
}): ConfiguredProviderResult {
    const provider =
        options.config.type === "codex"
            ? createConfiguredCodexProvider({
                  ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
                  config: options.config,
                  env: options.env,
                  id: options.id,
              })
            : options.config.type === "claude"
              ? createConfiguredClaudeProvider({
                    agentContext: options.agentContext,
                    config: options.config,
                    env: options.env,
                    id: options.id,
                    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
                })
              : options.config.type === "grok"
                ? createConfiguredGrokProvider({
                      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
                      config: options.config,
                      env: options.env,
                      id: options.id,
                      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
                  })
                : options.config.type === "kimi"
                  ? createConfiguredKimiProvider({
                        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
                        config: options.config,
                        env: options.env,
                        id: options.id,
                        ...(options.sessionId === undefined
                            ? {}
                            : { sessionId: options.sessionId }),
                    })
                  : createConfiguredBedrockProvider({
                        ...(options.sessionId === undefined ? {} : { agentId: options.sessionId }),
                        config: options.config,
                        env: options.env,
                        id: options.id,
                    });

    if (provider === undefined) {
        return {
            status: "missing_credential",
            variable:
                options.config.type === "bedrock"
                    ? (options.config.bearerTokenEnvVar ?? "AWS_BEARER_TOKEN_BEDROCK")
                    : "AWS_BEARER_TOKEN_BEDROCK",
        };
    }
    return {
        status: "available",
        provider: filterConfiguredProviderModels(
            provider,
            options.config,
            options.allowEmptyModels === undefined ? {} : { allowEmpty: options.allowEmptyModels },
        ),
    };
}
