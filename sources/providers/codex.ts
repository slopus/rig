import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
    clampThinkingLevel,
    getModels,
    type Model as PiModel,
    type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import {
    streamOpenAICodexResponses,
    type OpenAICodexResponsesOptions,
} from "@mariozechner/pi-ai/openai-codex-responses";

import { applyCodexImageDetailsToPayload } from "./applyCodexImageDetailsToPayload.js";
import { classifyCodexErrorCode } from "./classifyCodexErrorCode.js";
import { collectImageDetails } from "./collectImageDetails.js";
import {
    modelOpenaiGpt54,
    modelOpenaiGpt55,
    modelOpenaiGpt56Luna,
    modelOpenaiGpt56Sol,
    modelOpenaiGpt56Terra,
} from "./models.js";
import { toPiContext, wrapPiStream } from "./pi-bridge.js";
import { defineProvider, type Model, type Provider, type StreamOptions } from "./types.js";

const CODEX_PROVIDER_ID = "openai-codex";

function toPiCodexModelId(id: string): string {
    return id.startsWith("openai/") ? id.slice("openai/".length) : id;
}

export interface CodexProviderOptions {
    apiKey?: string;
    resolveApiKey?: () => string | undefined;
    useLocalCodexAuth?: boolean;
    codexAuthPath?: string;
    transport?: SimpleStreamOptions["transport"];
}

const codexModels = [
    modelOpenaiGpt56Sol,
    modelOpenaiGpt56Terra,
    modelOpenaiGpt56Luna,
    modelOpenaiGpt55,
    modelOpenaiGpt54,
] as const;
const codexThinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export function createCodexProvider(options: CodexProviderOptions = {}): Provider {
    const piModelById = new Map(getModels(CODEX_PROVIDER_ID).map((model) => [model.id, model]));
    for (const model of codexModels) {
        const piModelId = toPiCodexModelId(model.id);
        if (!piModelById.has(piModelId)) {
            piModelById.set(piModelId, createPiCodexModel(model));
        }
    }
    const resolveApiKey = buildApiKeyResolver(options);

    return defineProvider({
        id: "codex",
        models: codexModels,
        stream(model, context, streamOptions) {
            const piModel = piModelById.get(toPiCodexModelId(model.id));
            if (!piModel) {
                throw new Error(`Unknown codex model: ${model.id}`);
            }

            return wrapPiStream(
                streamOpenAICodexResponses(
                    piModel,
                    toPiContext(context),
                    toPiStreamOptions(
                        piModel,
                        streamOptions,
                        resolveApiKey(),
                        options.transport,
                        collectImageDetails(context),
                    ),
                ),
                { classifyError: classifyCodexErrorCode },
            );
        },
    });
}

function buildApiKeyResolver(options: CodexProviderOptions): () => string | undefined {
    if (options.apiKey) {
        return () => options.apiKey;
    }

    if (options.resolveApiKey) {
        return options.resolveApiKey;
    }

    if (options.useLocalCodexAuth === false) {
        return () => undefined;
    }

    return () => readLocalCodexAccessToken(options.codexAuthPath);
}

function readLocalCodexAccessToken(authPath?: string): string | undefined {
    const file = authPath ?? path.join(homedir(), ".codex", "auth.json");
    if (!existsSync(file)) {
        return undefined;
    }

    try {
        const data = JSON.parse(readFileSync(file, "utf8")) as {
            tokens?: { access_token?: unknown };
        };
        const token = data.tokens?.access_token;
        return typeof token === "string" && token.length > 0 ? token : undefined;
    } catch {
        return undefined;
    }
}

function createPiCodexModel(model: Model): PiModel<"openai-codex-responses"> {
    return {
        id: toPiCodexModelId(model.id),
        name: model.name,
        api: "openai-codex-responses",
        provider: CODEX_PROVIDER_ID,
        baseUrl: "https://chatgpt.com/backend-api",
        reasoning: true,
        thinkingLevelMap: Object.fromEntries(
            codexThinkingLevels.map((level) => [
                level,
                model.thinkingLevels.includes(level) ? level : null,
            ]),
        ),
        input: ["text", "image"],
        cost: {
            input: 5,
            output: 30,
            cacheRead: 0.5,
            cacheWrite: 0,
        },
        contextWindow: 372000,
        maxTokens: 128000,
    } as PiModel<"openai-codex-responses">;
}

function toPiStreamOptions(
    piModel: PiModel<"openai-codex-responses">,
    options: StreamOptions | undefined,
    apiKey: string | undefined,
    transport: SimpleStreamOptions["transport"],
    imageDetails: readonly ("high" | "original")[],
): OpenAICodexResponsesOptions {
    const piOptions: OpenAICodexResponsesOptions = {
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(transport !== undefined ? { transport } : {}),
        ...(imageDetails.includes("original")
            ? {
                  onPayload: (payload: unknown) =>
                      applyCodexImageDetailsToPayload(payload, imageDetails),
              }
            : {}),
    };

    if (options?.thinking !== undefined && options.thinking !== "off") {
        const level = isKnownPiThinkingLevel(options.thinking)
            ? clampThinkingLevel(piModel, options.thinking)
            : options.thinking;
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
