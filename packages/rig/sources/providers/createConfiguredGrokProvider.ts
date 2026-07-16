import type { ConfigGrokProvider } from "../config/types.js";
import { createGrokProvider } from "./grok.js";
import type { Provider } from "./types.js";

export function createConfiguredGrokProvider(options: {
    apiKey?: string;
    config: ConfigGrokProvider;
    env: NodeJS.ProcessEnv;
    id: string;
    sessionId?: string;
}): Provider {
    const baseUrl = options.config.baseUrl ?? options.env.RIG_GROK_BASE_URL;
    return createGrokProvider({
        env: options.env,
        id: options.id,
        ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        ...(options.config.authFile === undefined ? {} : { authFile: options.config.authFile }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    });
}
