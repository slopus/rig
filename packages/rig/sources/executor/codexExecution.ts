import {
    CodexApiKeyCredential,
    CodexProvider,
    CodexSessionCredential,
    createProviderQuotaCache,
    fetchCodexProviderQuota,
    unavailableProviderQuota,
} from "@slopus/rig-providers";
import { builtinModelProfiles, type ExecutorProvider } from "@slopus/rig-execution";

import type { ConfigCodexProvider } from "../config/types.js";

export function codexExecution(options: {
    apiKey?: string;
    config: ConfigCodexProvider;
    env: NodeJS.ProcessEnv;
    id: string;
    sessionId?: string;
}): ExecutorProvider {
    const baseUrl = options.config.baseUrl ?? options.env.RIG_CODEX_BASE_URL;
    const transport = options.config.transport ?? options.env.RIG_CODEX_TRANSPORT;
    const quota = createProviderQuotaCache(() =>
        options.apiKey !== undefined
            ? Promise.resolve(unavailableProviderQuota("codex", Date.now()))
            : fetchCodexProviderQuota({
                  env: options.env,
                  ...(options.config.authFile === undefined
                      ? {}
                      : { authPath: options.config.authFile }),
                  ...(baseUrl === undefined ? {} : { baseUrl }),
              }),
    );
    return {
        id: options.id,
        profiles: builtinModelProfiles(options.id, "codex"),
        serviceTiers: ["fast"],
        quota: (quotaOptions) => quota.get(quotaOptions),
        sessionId: options.sessionId ?? options.id,
        native: async () => {
            const credential =
                (options.apiKey === undefined
                    ? null
                    : await CodexApiKeyCredential.tryLoad({ apiKey: options.apiKey })) ??
                (await CodexSessionCredential.tryLoad({
                    env: options.env,
                    ...(options.config.authFile === undefined
                        ? {}
                        : { authFile: options.config.authFile }),
                }));
            if (credential === null) {
                throw new Error(
                    "Codex authentication is unavailable. Sign in with Codex or configure an API key.",
                );
            }
            return new CodexProvider({
                credential,
                parallelToolCalls: true,
                ...(baseUrl === undefined ? {} : { endpoint: baseUrl }),
                ...(transport === "auto" || transport === "sse" || transport === "websocket"
                    ? { transport }
                    : transport === "websocket-cached"
                      ? { transport: "websocket" as const }
                      : {}),
            });
        },
    };
}
