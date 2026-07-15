import type { ConfigBedrockProvider } from "../config/types.js";
import { readBedrockBearerToken } from "./readBedrockBearerToken.js";

export function readConfiguredBedrockBearerToken(
    config: ConfigBedrockProvider,
    env: NodeJS.ProcessEnv,
): string | undefined {
    if (config.bearerTokenEnvVar === undefined) return readBedrockBearerToken(env);
    const value = env[config.bearerTokenEnvVar]?.trim();
    return value === undefined || value.length === 0 ? undefined : value;
}
