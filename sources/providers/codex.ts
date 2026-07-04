import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  clampThinkingLevel,
  getModels,
  type Model as PiModel,
  type ModelThinkingLevel,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { streamSimpleOpenAICodexResponses } from "@mariozechner/pi-ai/openai-codex-responses";

import { modelOpenaiGpt54, modelOpenaiGpt55 } from "./models.js";
import { toPiContext, wrapPiStream } from "./pi-bridge.js";
import {
  defineProvider,
  type Provider,
  type StreamOptions,
} from "./types.js";

const CODEX_PROVIDER_ID = "openai-codex";

function toPiCodexModelId(id: string): string {
  return id.startsWith("openai/") ? id.slice("openai/".length) : id;
}

export interface CodexProviderOptions {
  apiKey?: string;
  resolveApiKey?: () => string | undefined;
  useLocalCodexAuth?: boolean;
  codexAuthPath?: string;
}

export function createCodexProvider(
  options: CodexProviderOptions = {},
): Provider {
  const piModelById = new Map(
    getModels(CODEX_PROVIDER_ID).map((model) => [model.id, model]),
  );
  const resolveApiKey = buildApiKeyResolver(options);

  return defineProvider({
    id: "codex",
    models: [modelOpenaiGpt55, modelOpenaiGpt54],
    stream(model, context, streamOptions) {
      const piModel = piModelById.get(toPiCodexModelId(model.id));
      if (!piModel) {
        throw new Error(`Unknown codex model: ${model.id}`);
      }

      return wrapPiStream(
        streamSimpleOpenAICodexResponses(
          piModel,
          toPiContext(context),
          toPiStreamOptions(piModel, streamOptions, resolveApiKey()),
        ),
      );
    },
  });
}

function buildApiKeyResolver(
  options: CodexProviderOptions,
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

function toPiStreamOptions(
  piModel: PiModel<"openai-codex-responses">,
  options: StreamOptions | undefined,
  apiKey: string | undefined,
): SimpleStreamOptions {
  const piOptions: SimpleStreamOptions = {
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
    ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
  };

  if (options?.thinking !== undefined && options.thinking !== "off") {
    const level = clampThinkingLevel(
      piModel,
      options.thinking as ModelThinkingLevel,
    );
    if (level !== "off") {
      piOptions.reasoning = level;
    }
  }

  return piOptions;
}

export type CodexProvider = ReturnType<typeof createCodexProvider>;
