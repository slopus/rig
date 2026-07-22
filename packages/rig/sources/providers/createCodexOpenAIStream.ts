import { existsSync, readFileSync } from "node:fs";

import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { CodexOpenAITransport } from "./CodexOpenAITransport.js";
import { classifyCodexErrorCode } from "./classifyCodexErrorCode.js";
import { classifyCodexProviderError } from "./classifyCodexProviderError.js";
import { createCodexOpenAIRequest } from "./createCodexOpenAIRequest.js";
import { createOpenAIResponsesStream } from "./createOpenAIResponsesStream.js";
import { readCodexQuotaAuth } from "./readCodexQuotaAuth.js";
import type { Context, Model, StreamOptions } from "./types.js";

export function createCodexOpenAIStream(options: {
    accessToken: string;
    authPath: string;
    baseUrl: string;
    context: Context;
    model: Model;
    modelId: string;
    providerId: string;
    openAITransport: CodexOpenAITransport;
    streamOptions?: StreamOptions;
    transport?: SimpleStreamOptions["transport"];
}): ReturnType<typeof createOpenAIResponsesStream> {
    return createOpenAIResponsesStream({
        async createResponseStream() {
            const accountId = resolveCodexAccountId(options.accessToken, options.authPath);
            const request = createCodexOpenAIRequest({
                context: options.context,
                modelId: options.modelId,
                ...(options.streamOptions === undefined
                    ? {}
                    : { streamOptions: options.streamOptions }),
            });
            if (options.transport !== "sse") {
                return options.openAITransport.createWebSocketResponseStream({
                    accessToken: options.accessToken,
                    accountId,
                    baseUrl: options.baseUrl,
                    request,
                    useIncrementalContext: options.transport !== "websocket",
                    ...(options.streamOptions?.sessionId === undefined
                        ? {}
                        : { sessionId: options.streamOptions.sessionId }),
                    ...(options.streamOptions?.signal === undefined
                        ? {}
                        : { signal: options.streamOptions.signal }),
                });
            }
            return options.openAITransport.createSseResponseStream({
                accessToken: options.accessToken,
                accountId,
                baseUrl: options.baseUrl,
                request,
                ...(options.streamOptions?.sessionId === undefined
                    ? {}
                    : { sessionId: options.streamOptions.sessionId }),
                ...(options.streamOptions?.signal === undefined
                    ? {}
                    : { signal: options.streamOptions.signal }),
            });
        },
        classifyError: classifyCodexErrorCode,
        classifyProviderError: classifyCodexProviderError,
        failureMessage: `${options.model.name} failed to generate a response.`,
        modelId: options.model.id,
        providerId: options.providerId,
        ...(options.streamOptions?.signal === undefined
            ? {}
            : { signal: options.streamOptions.signal }),
    });
}

function resolveCodexAccountId(accessToken: string, authPath: string): string {
    const stored = existsSync(authPath)
        ? readCodexQuotaAuth(readFileSync(authPath, "utf8"))
        : undefined;
    const auth =
        stored?.accessToken === accessToken
            ? stored
            : readCodexQuotaAuth(JSON.stringify({ tokens: { access_token: accessToken } }));
    if (auth?.accountId === undefined) {
        throw new Error("Codex authentication is missing a ChatGPT account ID.");
    }
    return auth.accountId;
}
