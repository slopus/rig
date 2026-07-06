import { createNodeAgentContext } from "../agent/index.js";
import { NativeProxessManager } from "../processes/index.js";
import type { ModelCatalog } from "../protocol/index.js";
import { createClaudeSdkProvider } from "../providers/claude-sdk.js";
import { createCodexProvider } from "../providers/codex.js";
import { modelOpenaiGpt55 } from "../providers/models.js";
import { claudeCodeTools } from "../tools/claude/index.js";

export interface CreateModelCatalogOptions {
    cwd?: string;
}

export function createModelCatalog(options: CreateModelCatalogOptions = {}): ModelCatalog {
    const cwd = options.cwd ?? process.cwd();
    const context = createNodeAgentContext({
        cwd,
        processManager: new NativeProxessManager(),
    });
    const providers = [
        createCodexProvider(),
        createClaudeSdkProvider({
            agentContext: context,
            tools: claudeCodeTools,
        }),
    ];

    return {
        defaultModelId: modelOpenaiGpt55.id,
        models: providers.flatMap((provider) => provider.models),
        providers: providers.map((provider) => ({
            providerId: provider.id,
            models: provider.models,
        })),
    };
}
