import { existsSync, readFileSync } from "node:fs";

import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import OpenAI from "openai";

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
    streamOptions?: StreamOptions;
    transport?: SimpleStreamOptions["transport"];
}): ReturnType<typeof createOpenAIResponsesStream> {
    if (options.transport === "websocket" || options.transport === "websocket-cached") {
        throw new Error("Codex Code Mode custom tools require the SSE transport.");
    }
    return createOpenAIResponsesStream({
        async createResponseStream() {
            const accountId = resolveCodexAccountId(options.accessToken, options.authPath);
            const client = new OpenAI({
                apiKey: options.accessToken,
                baseURL: `${options.baseUrl.replace(/\/$/, "")}/codex`,
                defaultHeaders: {
                    "chatgpt-account-id": accountId,
                    originator: "codex_cli_rs",
                    "OpenAI-Beta": "responses=experimental",
                    ...(options.streamOptions?.sessionId === undefined
                        ? {}
                        : {
                              "session-id": options.streamOptions.sessionId,
                              "x-client-request-id": options.streamOptions.sessionId,
                          }),
                },
                maxRetries: 0,
            });
            return client.responses.create(
                createCodexOpenAIRequest({
                    context: options.context,
                    modelId: options.modelId,
                    ...(options.streamOptions === undefined
                        ? {}
                        : { streamOptions: options.streamOptions }),
                }),
                ...(options.streamOptions?.signal === undefined
                    ? []
                    : [{ signal: options.streamOptions.signal }]),
            );
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
