import OpenAI from "openai";
import { Agent, fetch } from "undici";

export interface GrokOpenAIClient extends Pick<OpenAI, "responses"> {
    close(): Promise<void>;
}

export function createGrokOpenAIClient(options: {
    baseUrl: string;
    token: string;
    forceHttp1?: boolean;
}): GrokOpenAIClient {
    const dispatcher = new Agent({
        allowH2: options.forceHttp1 !== true,
        keepAliveTimeout: 60_000,
        keepAliveMaxTimeout: 600_000,
    });
    const client = new OpenAI({
        apiKey: options.token,
        baseURL: options.baseUrl,
        fetch: fetch as unknown as typeof globalThis.fetch,
        fetchOptions: { dispatcher } as never,
        maxRetries: 0,
    });
    return {
        responses: client.responses,
        close: () => dispatcher.close(),
    };
}
