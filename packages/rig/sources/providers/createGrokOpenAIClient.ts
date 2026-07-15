import OpenAI from "openai";

export type GrokOpenAIClient = Pick<OpenAI, "responses">;

export function createGrokOpenAIClient(options: {
    baseUrl: string;
    headers: Record<string, string>;
    token: string;
}): OpenAI {
    return new OpenAI({
        apiKey: options.token,
        baseURL: options.baseUrl,
        defaultHeaders: options.headers,
        maxRetries: 0,
    });
}
