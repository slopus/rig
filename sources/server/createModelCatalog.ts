import { createNodeAgentContext } from "../agent/index.js";
import { NativeProxessManager } from "../processes/index.js";
import type { ModelCatalog } from "../protocol/index.js";
import { createBedrockProvider } from "../providers/bedrock.js";
import { createClaudeSdkProvider } from "../providers/claude-sdk.js";
import { createCodexProvider } from "../providers/codex.js";
import { modelOpenaiGpt56Sol } from "../providers/models.js";
import { readBedrockBearerToken } from "../providers/readBedrockBearerToken.js";
import type { Provider } from "../providers/types.js";
import { claudeCodeTools } from "../tools/claude/index.js";
import { uniqueModelsById } from "./uniqueModelsById.js";

export interface CreateModelCatalogOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
}

export function createModelCatalog(options: CreateModelCatalogOptions = {}): ModelCatalog {
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    const context = createNodeAgentContext({
        cwd,
        processManager: new NativeProxessManager(),
    });
    const providers: Provider[] = [
        createCodexProvider(),
        createClaudeSdkProvider({
            agentContext: context,
            tools: claudeCodeTools,
        }),
    ];
    const bedrockBearerToken = readBedrockBearerToken(env);
    if (bedrockBearerToken !== undefined) {
        providers.push(
            createBedrockProvider({
                bearerToken: bedrockBearerToken,
                env,
            }),
        );
    }

    return {
        defaultModelId: modelOpenaiGpt56Sol.id,
        defaultProviderId: "codex",
        models: uniqueModelsById(providers.flatMap((provider) => provider.models)),
        providers: providers.map((provider) => ({
            providerId: provider.id,
            models: provider.models,
        })),
    };
}
