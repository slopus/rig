import { BedrockOpenAI } from "openai";

export type BedrockOpenAIClient = Pick<BedrockOpenAI, "responses">;

export function createBedrockOpenAIClient(options: {
    bearerToken: string;
    region: string;
}): BedrockOpenAI {
    return new BedrockOpenAI({
        apiKey: options.bearerToken,
        awsRegion: options.region,
    });
}
