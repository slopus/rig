import { createGrokOpenAIClient, type GrokOpenAIClient } from "./createGrokOpenAIClient.js";
import { createGrokStream } from "./createGrokStream.js";
import { GROK_DEFAULT_BASE_URL, GROK_PROVIDER_ID } from "./grok-constants.js";
import { modelsForProfileProviderType } from "../profiles/impl/modelsForProfileProviderType.js";
import { resolveModelProfile } from "../profiles/impl/resolveModelProfile.js";
import { resolveGrokCredential } from "./resolveGrokCredential.js";
import { defineProvider, type Provider } from "./types.js";

export { GROK_API_MODEL_ID, GROK_DEFAULT_BASE_URL, GROK_PROVIDER_ID } from "./grok-constants.js";

export interface GrokProviderOptions {
    apiKey?: string;
    authFile?: string;
    baseUrl?: string;
    client?: GrokOpenAIClient;
    clientFactory?: (options: Parameters<typeof createGrokOpenAIClient>[0]) => GrokOpenAIClient;
    env?: NodeJS.ProcessEnv;
    id?: string;
    resolveCredential?: typeof resolveGrokCredential;
    sessionId?: string;
}

export function createGrokProvider(options: GrokProviderOptions = {}): Provider {
    const providerId = options.id ?? GROK_PROVIDER_ID;
    const models = modelsForProfileProviderType("grok");
    let cachedClient: { client: GrokOpenAIClient; token: string } | undefined;
    const resolveClient = async (): Promise<GrokOpenAIClient> => {
        const credential = await (options.resolveCredential ?? resolveGrokCredential)({
            ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
            ...(options.authFile === undefined ? {} : { authFile: options.authFile }),
            ...(options.env === undefined ? {} : { env: options.env }),
        });
        if (options.client !== undefined) return options.client;
        if (cachedClient?.token === credential.token) return cachedClient.client;
        const client = (options.clientFactory ?? createGrokOpenAIClient)({
            baseUrl: options.baseUrl ?? GROK_DEFAULT_BASE_URL,
            token: credential.token,
        });
        cachedClient = { client, token: credential.token };
        return client;
    };
    return defineProvider({
        contextCompatibility: "model_group",
        id: providerId,
        profileType: "grok",
        imageProfile: () => "codex",
        toolProfile: () => "grok",
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
                resolveClient,
                ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
                ...(streamOptions === undefined ? {} : { streamOptions }),
            });
        },
    });
}

export type GrokProvider = ReturnType<typeof createGrokProvider>;

function toGrokApiModelId(modelId: string): string {
    const profile = resolveModelProfile("grok", modelId);
    if (profile?.parameters.wireModelId !== undefined) return profile.parameters.wireModelId;
    return modelId.startsWith("xai/") ? modelId.slice("xai/".length) : modelId;
}
