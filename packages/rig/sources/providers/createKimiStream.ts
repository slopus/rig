import { createKimiChatCompletionStream } from "./createKimiChatCompletionStream.js";
import { createKimiChatRequest } from "./createKimiChatRequest.js";
import type { KimiChatClient } from "./kimi-chat-types.js";
import { createKimiOpenAIClient } from "./createKimiOpenAIClient.js";
import { createKimiRequestHeaders } from "./createKimiRequestHeaders.js";
import { getKimiHome } from "./getKimiHome.js";
import { isKimiUnauthorizedError } from "./isKimiUnauthorizedError.js";
import { resolveKimiCredential } from "./resolveKimiCredential.js";
import type { Context, Model, StreamOptions } from "./types.js";

export interface KimiClientCache {
    client?: KimiChatClient;
    token?: string;
}

export function createKimiStream(options: {
    apiKey?: string;
    apiModelId: string;
    authFile?: string;
    baseUrl: string;
    clientFactory?: (options: {
        baseUrl: string;
        headers: Record<string, string>;
        token: string;
    }) => KimiChatClient;
    clientCache: KimiClientCache;
    context: Context;
    env?: NodeJS.ProcessEnv;
    maxCompletionTokens: number;
    model: Model;
    modelId: string;
    providerId: string;
    resolveCredential?: typeof resolveKimiCredential;
    sessionId?: string;
    streamOptions?: StreamOptions;
}): ReturnType<typeof createKimiChatCompletionStream> {
    const env = options.env ?? process.env;
    const headers = createKimiRequestHeaders({
        env,
        kimiHome: getKimiHome(env),
    });
    const request = createKimiChatRequest({
        apiModelId: options.apiModelId,
        context: options.context,
        maxCompletionTokens: options.maxCompletionTokens,
        model: options.model,
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        ...(options.streamOptions === undefined ? {} : { streamOptions: options.streamOptions }),
    });
    const clientFactory = options.clientFactory ?? createKimiOpenAIClient;
    const credentialResolver = options.resolveCredential ?? resolveKimiCredential;
    const client: KimiChatClient = {
        chat: {
            completions: {
                async create(chatRequest, requestOptions) {
                    const create = async (force: boolean) => {
                        const credential = await credentialResolver({
                            ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
                            ...(options.authFile === undefined
                                ? {}
                                : { authFile: options.authFile }),
                            env,
                            force,
                        });
                        let cachedClient = options.clientCache.client;
                        if (
                            force ||
                            cachedClient === undefined ||
                            options.clientCache.token !== credential.token
                        ) {
                            cachedClient = clientFactory({
                                baseUrl: options.baseUrl,
                                headers,
                                token: credential.token,
                            });
                            options.clientCache.client = cachedClient;
                            options.clientCache.token = credential.token;
                        }
                        return cachedClient.chat.completions.create(chatRequest, requestOptions);
                    };
                    try {
                        return await create(false);
                    } catch (error) {
                        if (!isKimiUnauthorizedError(error)) throw error;
                        return create(true);
                    }
                },
            },
        },
    };
    return createKimiChatCompletionStream({
        client,
        modelId: options.modelId,
        providerId: options.providerId,
        request,
        ...(options.streamOptions?.signal === undefined
            ? {}
            : { signal: options.streamOptions.signal }),
    });
}
