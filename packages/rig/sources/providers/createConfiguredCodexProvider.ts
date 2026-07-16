import type { ConfigCodexProvider } from "../config/types.js";
import { createCodexProvider, type CodexProviderOptions } from "./codex.js";
import type { Provider } from "./types.js";

export function createConfiguredCodexProvider(options: {
    apiKey?: string;
    config: ConfigCodexProvider;
    env: NodeJS.ProcessEnv;
    id: string;
}): Provider {
    const providerOptions: CodexProviderOptions = { env: options.env, id: options.id };
    if (options.apiKey !== undefined) providerOptions.apiKey = options.apiKey;
    if (options.config.authFile !== undefined) {
        providerOptions.codexAuthPath = options.config.authFile;
    }
    const baseUrl = options.config.baseUrl ?? options.env.RIG_CODEX_BASE_URL;
    if (baseUrl !== undefined) providerOptions.baseUrl = baseUrl;
    const transport = options.config.transport ?? options.env.RIG_CODEX_TRANSPORT;
    if (
        transport === "auto" ||
        transport === "sse" ||
        transport === "websocket" ||
        transport === "websocket-cached"
    ) {
        providerOptions.transport = transport;
    }
    return createCodexProvider(providerOptions);
}
