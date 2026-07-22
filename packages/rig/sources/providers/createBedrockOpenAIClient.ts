import { BedrockOpenAI } from "openai";

export type BedrockOpenAIClient = Pick<BedrockOpenAI, "responses">;

export function createBedrockOpenAIClient(options: {
    bearerToken: string;
    endpoint?: string;
    region: string;
}): BedrockOpenAI {
    return new BedrockOpenAI({
        apiKey: options.bearerToken,
        awsRegion: options.region,
        defaultHeaders: {
            "x-amzn-mantle-client-agent": "codex",
            "x-codex-beta-features": "remote_compaction_v2",
            originator: "codex_sdk_ts",
        },
        maxRetries: 0,
        ...(options.endpoint === undefined ? {} : { baseURL: options.endpoint }),
    });
}
