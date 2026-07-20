import type { RigConfig } from "./types.js";

export const DEFAULT_RIG_CONFIG: RigConfig = {
    defaults: {
        modelId: "openai/gpt-5.5",
        permissionMode: "workspace_write",
    },
    features: {
        workflows: true,
    },
    mcpServers: {},
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
        kimi: {
            enabled: true,
            type: "kimi",
        },
    },
    settings: {
        compactCompletedTurns: false,
        completionChime: false,
        durableGlobalEventQueue: false,
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
