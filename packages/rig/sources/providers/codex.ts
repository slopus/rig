import { existsSync, readFileSync } from "node:fs";

import {
    clampThinkingLevel,
    type Model as PiModel,
    type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
    stream as streamOpenAICodexResponses,
    type OpenAICodexResponsesOptions,
} from "@earendil-works/pi-ai/api/openai-codex-responses";

import { applyCodexImageDetailsToPayload } from "./applyCodexImageDetailsToPayload.js";
import { classifyCodexErrorCode } from "./classifyCodexErrorCode.js";
import { classifyCodexProviderError } from "./classifyCodexProviderError.js";
import { collectOriginalImageUrls } from "./collectOriginalImageUrls.js";
import { createPiCodexModel } from "./createPiCodexModel.js";
import { modelsForProfileProviderType } from "../profiles/impl/modelsForProfileProviderType.js";
import { resolveModelProfile } from "../profiles/impl/resolveModelProfile.js";
import { serviceTiersForProfileProviderType } from "../profiles/impl/serviceTiersForProfileProviderType.js";
import { normalizeCodexThinkingLevel } from "./normalizeCodexThinkingLevel.js";
import { toPiContext, wrapPiStream } from "./pi-bridge.js";
import { defineProvider, type Provider, type StreamOptions } from "./types.js";
import { createProviderQuotaCache } from "./createProviderQuotaCache.js";
import { fetchCodexProviderQuota } from "./fetchCodexProviderQuota.js";
import { getCodexAuthPath } from "./getCodexAuthPath.js";
import { unavailableProviderQuota } from "./unavailableProviderQuota.js";
import { createCodexOpenAIStream } from "./createCodexOpenAIStream.js";

const CODEX_PROVIDER_ID = "openai-codex";

function toPiCodexModelId(id: string): string {
    const profile = resolveModelProfile("codex", id);
    if (profile?.parameters.wireModelId !== undefined) return profile.parameters.wireModelId;
    return id.startsWith("openai/") ? id.slice("openai/".length) : id;
}

export interface CodexProviderOptions {
    apiKey?: string;
    baseUrl?: string;
    resolveApiKey?: () => string | undefined;
    useLocalCodexAuth?: boolean;
    codexAuthPath?: string;
    env?: NodeJS.ProcessEnv;
    id?: string;
    transport?: SimpleStreamOptions["transport"];
}

const codexModels = modelsForProfileProviderType("codex");
export function createCodexProvider(options: CodexProviderOptions = {}): Provider {
    const authPath = getCodexAuthPath({
        ...(options.codexAuthPath === undefined ? {} : { authFile: options.codexAuthPath }),
        ...(options.env === undefined ? {} : { env: options.env }),
    });
    const piModelById = new Map(
        getBuiltinModels(CODEX_PROVIDER_ID).map((model) => [model.id, model]),
    );
    for (const model of codexModels) {
        const piModelId = toPiCodexModelId(model.id);
        if (!piModelById.has(piModelId)) {
            piModelById.set(piModelId, createPiCodexModel(model, piModelId));
        }
    }
    if (options.baseUrl !== undefined) {
        for (const [modelId, model] of piModelById) {
            piModelById.set(modelId, { ...model, baseUrl: options.baseUrl });
        }
    }
    const resolveApiKey = buildApiKeyResolver(options, authPath);
    const quota = createProviderQuotaCache(() =>
        options.apiKey !== undefined ||
        options.resolveApiKey !== undefined ||
        options.useLocalCodexAuth === false
            ? Promise.resolve(unavailableProviderQuota("codex", Date.now()))
            : fetchCodexProviderQuota({
                  ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
                  authPath,
              }),
    );

    return defineProvider({
        contextCompatibility: "model_group",
        id: options.id ?? "codex",
        profileType: "codex",
        imageProfile: () => "codex",
        toolProfile: () => "codex",
        models: codexModels,
        serviceTiers: serviceTiersForProfileProviderType("codex"),
        quota: (quotaOptions) => quota.get(quotaOptions),
        stream(model, context, streamOptions) {
            const piModel = piModelById.get(toPiCodexModelId(model.id));
            if (!piModel) {
                throw new Error(`Unknown codex model: ${model.id}`);
            }

            const accessToken = resolveApiKey();
            if (context.tools?.some((tool) => tool.kind === "custom") === true) {
                if (accessToken === undefined) {
                    throw new Error("Codex authentication is unavailable.");
                }
                return createCodexOpenAIStream({
                    accessToken,
                    authPath,
                    baseUrl: options.baseUrl ?? "https://chatgpt.com/backend-api",
                    context,
                    model,
                    modelId: toPiCodexModelId(model.id),
                    providerId: options.id ?? "codex",
                    ...(options.transport === undefined ? {} : { transport: options.transport }),
                    ...(streamOptions === undefined ? {} : { streamOptions }),
                });
            }

            return wrapPiStream(
                streamOpenAICodexResponses(
                    piModel,
                    toPiContext(context),
                    toPiStreamOptions(
                        piModel,
                        streamOptions,
                        accessToken,
                        options.transport,
                        collectOriginalImageUrls(context),
                    ),
                ),
                {
                    classifyError: classifyCodexErrorCode,
                    classifyProviderError: classifyCodexProviderError,
                },
            );
        },
    });
}

function buildApiKeyResolver(
    options: CodexProviderOptions,
    authPath: string,
): () => string | undefined {
    if (options.apiKey) {
        return () => options.apiKey;
    }

    if (options.resolveApiKey) {
        return options.resolveApiKey;
    }

    if (options.useLocalCodexAuth === false) {
        return () => undefined;
    }

    return () => readLocalCodexAccessToken(authPath);
}

function readLocalCodexAccessToken(authPath: string): string | undefined {
    if (!existsSync(authPath)) {
        return undefined;
    }

    try {
        const data = JSON.parse(readFileSync(authPath, "utf8")) as {
            tokens?: { access_token?: unknown };
        };
        const token = data.tokens?.access_token;
        return typeof token === "string" && token.length > 0 ? token : undefined;
    } catch {
        return undefined;
    }
}

function toPiStreamOptions(
    piModel: PiModel<"openai-codex-responses">,
    options: StreamOptions | undefined,
    apiKey: string | undefined,
    transport: SimpleStreamOptions["transport"],
    originalImageUrls: ReadonlySet<string>,
): OpenAICodexResponsesOptions {
    const piOptions: OpenAICodexResponsesOptions = {
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        ...(options?.serviceTier === "fast" ? { serviceTier: "priority" as const } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(transport !== undefined ? { transport } : {}),
        ...(originalImageUrls.size > 0
            ? {
                  onPayload: (payload: unknown) =>
                      applyCodexImageDetailsToPayload(payload, originalImageUrls),
              }
            : {}),
    };

    if (options?.thinking !== undefined && options.thinking !== "off") {
        const normalizedLevel = normalizeCodexThinkingLevel(options.thinking);
        const level = isKnownPiThinkingLevel(normalizedLevel)
            ? clampThinkingLevel(piModel, normalizedLevel)
            : normalizedLevel;
        if (level !== "off") {
            piOptions.reasoningEffort = level as NonNullable<
                OpenAICodexResponsesOptions["reasoningEffort"]
            >;
        }
    }

    return piOptions;
}

function isKnownPiThinkingLevel(
    level: string,
): level is "minimal" | "low" | "medium" | "high" | "xhigh" {
    return (
        level === "minimal" ||
        level === "low" ||
        level === "medium" ||
        level === "high" ||
        level === "xhigh"
    );
}

export type CodexProvider = ReturnType<typeof createCodexProvider>;
