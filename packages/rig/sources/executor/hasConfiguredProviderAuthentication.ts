import {
    ClaudeApiKeyCredential,
    ClaudeAuthTokenCredential,
    ClaudeOAuthCredential,
    CodexSessionCredential,
    GrokApiKeyCredential,
    GrokSessionCredential,
} from "@slopus/rig-providers";

import type { ConfigProvider } from "../config/types.js";
import { readConfiguredBedrockBearerToken } from "./readConfiguredBedrockBearerToken.js";

export async function hasConfiguredProviderAuthentication(options: {
    config: ConfigProvider;
    env: NodeJS.ProcessEnv;
}): Promise<boolean> {
    const { config, env } = options;
    try {
        if (config.type === "bedrock") {
            return readConfiguredBedrockBearerToken(config, env) !== undefined;
        }
        if (config.type === "codex") {
            return (
                (await CodexSessionCredential.tryLoad({
                    ...(config.authFile === undefined ? {} : { authFile: config.authFile }),
                    env,
                })) !== null
            );
        }
        if (config.type === "claude") {
            return (
                ((config.oauthToken === undefined
                    ? null
                    : await ClaudeOAuthCredential.tryLoad({
                          env,
                          oauthToken: config.oauthToken,
                      })) ??
                    (await ClaudeApiKeyCredential.tryLoad({ env })) ??
                    (await ClaudeAuthTokenCredential.tryLoad({ env })) ??
                    (await ClaudeOAuthCredential.tryLoad({
                        env,
                        ...(config.configDir === undefined ? {} : { configDir: config.configDir }),
                    }))) !== null
            );
        }
        if (config.type === "grok") {
            return (
                ((await GrokApiKeyCredential.tryLoad({
                    ...(config.authFile === undefined ? {} : { authFile: config.authFile }),
                    env,
                })) ??
                    (await GrokSessionCredential.tryLoad({
                        ...(config.authFile === undefined ? {} : { authFile: config.authFile }),
                        env,
                    }))) !== null
            );
        }
        config satisfies never;
        return false;
    } catch {
        return false;
    }
}
