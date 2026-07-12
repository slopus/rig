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
        showReasoning: false,
        showUsage: false,
    },
};
