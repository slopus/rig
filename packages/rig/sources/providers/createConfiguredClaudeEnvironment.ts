import type { ConfigClaudeProvider } from "../config/types.js";

export function createConfiguredClaudeEnvironment(
    config: ConfigClaudeProvider,
    env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
    const configured: NodeJS.ProcessEnv = {
        ...env,
        ...(config.configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: config.configDir }),
        ...(config.oauthToken === undefined ? {} : { CLAUDE_CODE_OAUTH_TOKEN: config.oauthToken }),
    };
    if (config.oauthToken !== undefined) {
        delete configured.ANTHROPIC_API_KEY;
        delete configured.ANTHROPIC_AUTH_TOKEN;
        delete configured.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR;
        delete configured.CLAUDE_CODE_USE_BEDROCK;
        delete configured.CLAUDE_CODE_USE_FOUNDRY;
        delete configured.CLAUDE_CODE_USE_VERTEX;
    }
    return configured;
}
