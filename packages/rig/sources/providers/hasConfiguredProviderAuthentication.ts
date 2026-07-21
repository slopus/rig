import type { ConfigProvider } from "../config/types.js";
import { getCodexAuthPath } from "./getCodexAuthPath.js";
import { getGrokAuthPath } from "./getGrokAuthPath.js";
import { getKimiAuthPath } from "./getKimiAuthPath.js";
import { readClaudeCodeOAuthToken } from "./readClaudeCodeOAuthToken.js";
import { readCodexAccessToken } from "./readCodexAccessToken.js";
import { readConfiguredBedrockBearerToken } from "./readConfiguredBedrockBearerToken.js";
import { readGrokAuthStore } from "./readGrokAuthStore.js";
import { readKimiAuthRecord } from "./readKimiAuthRecord.js";
import { selectGrokAuthRecord } from "./selectGrokAuthRecord.js";

export async function hasConfiguredProviderAuthentication(options: {
    config: ConfigProvider;
    env: NodeJS.ProcessEnv;
}): Promise<boolean> {
    const { config, env } = options;
    if (config.type === "bedrock") {
        return readConfiguredBedrockBearerToken(config, env) !== undefined;
    }
    if (config.type === "codex") {
        return (
            (await readCodexAccessToken(
                getCodexAuthPath({
                    ...(config.authFile === undefined ? {} : { authFile: config.authFile }),
                    env,
                }),
            )) !== undefined
        );
    }
    if (config.type === "claude") {
        if (config.oauthToken?.trim()) return true;
        if (
            env.ANTHROPIC_API_KEY?.trim() ||
            env.ANTHROPIC_AUTH_TOKEN?.trim() ||
            env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
        ) {
            return true;
        }
        const claudeEnv =
            config.configDir === undefined ? env : { ...env, CLAUDE_CONFIG_DIR: config.configDir };
        return (await readClaudeCodeOAuthToken(claudeEnv)) !== undefined;
    }
    if (config.type === "grok") {
        if (env.XAI_API_KEY?.trim()) return true;
        try {
            return (
                selectGrokAuthRecord(
                    await readGrokAuthStore(
                        getGrokAuthPath({
                            ...(config.authFile === undefined ? {} : { authFile: config.authFile }),
                            env,
                        }),
                    ),
                ) !== undefined
            );
        } catch {
            return false;
        }
    }
    if (config.type === "kimi") {
        if (env.KIMI_API_KEY?.trim()) return true;
        try {
            const record = await readKimiAuthRecord(
                getKimiAuthPath({
                    ...(config.authFile === undefined ? {} : { authFile: config.authFile }),
                    env,
                }),
            );
            return record !== undefined && record.access_token.trim().length > 0;
        } catch {
            return false;
        }
    }
    config satisfies never;
    return false;
}
