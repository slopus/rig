import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

export type CodexResponseRequest = ResponseCreateParamsStreaming & {
    client_metadata?: Record<string, unknown>;
    generate?: boolean;
};
