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
    settings: {
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
