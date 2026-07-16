import type { AgentContext } from "../agent/context/AgentContext.js";
import type { ConfigClaudeProvider } from "../config/types.js";
import { createClaudeSdkProvider } from "./claude-sdk.js";
import { createClaudeSessionId } from "./createClaudeSessionId.js";
import type { Provider } from "./types.js";

export function createConfiguredClaudeProvider(options: {
    agentContext: AgentContext;
    config: ConfigClaudeProvider;
    env: NodeJS.ProcessEnv;
    id: string;
    sessionId?: string;
}): Provider {
    const executable = options.config.executable ?? options.env.RIG_CLAUDE_CODE_EXECUTABLE;
    return createClaudeSdkProvider({
        agentContext: options.agentContext,
        env:
            options.config.configDir === undefined
                ? options.env
                : { ...options.env, CLAUDE_CONFIG_DIR: options.config.configDir },
        id: options.id,
        ...(executable === undefined ? {} : { pathToClaudeCodeExecutable: executable }),
        ...(options.sessionId === undefined
            ? {}
            : { sessionId: createClaudeSessionId(options.sessionId) }),
    });
}
