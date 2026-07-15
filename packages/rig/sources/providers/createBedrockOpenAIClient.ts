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
        ...(options.endpoint === undefined ? {} : { baseURL: options.endpoint }),
    });
}
