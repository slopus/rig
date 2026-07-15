import type { GrokOpenAIClient } from "./createGrokOpenAIClient.js";
import { createGrokStream } from "./createGrokStream.js";
import { GROK_DEFAULT_BASE_URL, GROK_PROVIDER_ID } from "./grok-constants.js";
import { modelXaiGrokBuild } from "./models.js";
import { resolveGrokCredential } from "./resolveGrokCredential.js";
import { defineProvider, type Model, type Provider } from "./types.js";

export { GROK_API_MODEL_ID, GROK_DEFAULT_BASE_URL, GROK_PROVIDER_ID } from "./grok-constants.js";

export interface GrokProviderOptions {
    apiKey?: string;
    authFile?: string;
    baseUrl?: string;
    client?: GrokOpenAIClient;
    env?: NodeJS.ProcessEnv;
    id?: string;
    models?: readonly Model[];
    resolveCredential?: typeof resolveGrokCredential;
    sessionId?: string;
}

export function createGrokProvider(options: GrokProviderOptions = {}): Provider {
    const providerId = options.id ?? GROK_PROVIDER_ID;
    const models = options.models ?? [modelXaiGrokBuild];
    return defineProvider({
        id: providerId,
        models,
        stream(model, context, streamOptions) {
            const availableModel = models.find((candidate) => candidate.id === model.id);
            if (availableModel === undefined) {
                throw new Error(`Grok model '${model.name}' is not available.`);
            }
            return createGrokStream({
                apiModelId: toGrokApiModelId(availableModel.id),
                baseUrl: options.baseUrl ?? GROK_DEFAULT_BASE_URL,
                context,
                model: availableModel,
                modelId: availableModel.id,
                providerId,
                ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
                ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
                ...(options.client === undefined ? {} : { client: options.client }),
                ...(options.env === undefined ? {} : { env: options.env }),
                ...(options.resolveCredential === undefined
                    ? {}
                    : { resolveCredential: options.resolveCredential }),
                ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
                ...(streamOptions === undefined ? {} : { streamOptions }),
            });
        },
    });
}

export type GrokProvider = ReturnType<typeof createGrokProvider>;

function toGrokApiModelId(modelId: string): string {
    return modelId.startsWith("xai/") ? modelId.slice("xai/".length) : modelId;
}
