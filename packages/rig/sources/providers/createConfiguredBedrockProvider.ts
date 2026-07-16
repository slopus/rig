import type { ConfigBedrockProvider } from "../config/types.js";
import { createBedrockProvider } from "./bedrock.js";
import { readConfiguredBedrockBearerToken } from "./readConfiguredBedrockBearerToken.js";
import type { Provider } from "./types.js";

export function createConfiguredBedrockProvider(options: {
    config: ConfigBedrockProvider;
    env: NodeJS.ProcessEnv;
    id: string;
}): Provider | undefined {
    const bearerToken = readConfiguredBedrockBearerToken(options.config, options.env);
    if (bearerToken === undefined) return undefined;
    return createBedrockProvider({
        bearerToken,
        env: options.env,
        id: options.id,
        ...(options.config.modelOverrides === undefined
            ? {}
            : { modelOverrides: options.config.modelOverrides }),
        ...(options.config.region === undefined ? {} : { region: options.config.region }),
    });
}
