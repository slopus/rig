import type { RigConfig } from "./types.js";

export const DEFAULT_RIG_CONFIG: RigConfig = {
    defaults: {
        modelId: "openai/gpt-5.6-sol",
        permissionMode: "workspace_write",
    },
    features: {
        workflows: true,
    },
    mcpServers: {},
    providerDefaultEnable: true,
    providers: {
        codex: {
            enabled: true,
            type: "codex",
        },
        claude: {
            enabled: true,
            type: "claude",
        },
        bedrock: {
            enabled: true,
            type: "bedrock",
        },
        grok: {
            enabled: true,
            type: "grok",
        },
    },
    settings: {
        compactCompletedTurns: false,
        completionChime: false,
        durableGlobalEventQueue: false,
        happyIntegration: true,
        showReasoning: false,
        showUsage: false,
    },
    theme: {
        accent: "cyan",
        brand: "ansi:202",
        error: "red",
        primary: "default",
        secondary: "dim",
        success: "green",
        warning: "yellow",
    },
};
