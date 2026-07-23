import { BedrockOpenAI } from "openai";

export type BedrockClient = Pick<BedrockOpenAI, "responses">;

export function createBedrockClient(options: {
    bearerToken: string;
    endpoint?: string;
    region: string;
    userAgent: string;
}): BedrockOpenAI {
    return new BedrockOpenAI({
        apiKey: options.bearerToken,
        awsRegion: options.region,
        defaultHeaders: {
            "x-amzn-mantle-client-agent": "codex",
            "x-codex-beta-features": "remote_compaction_v2",
            originator: "codex_exec",
            "user-agent": options.userAgent,
        },
        maxRetries: 0,
        ...(options.endpoint === undefined ? {} : { baseURL: options.endpoint }),
    });
}
