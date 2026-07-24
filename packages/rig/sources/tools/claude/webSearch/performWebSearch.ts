import type { Model, Provider } from "@slopus/rig-execution";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages.mjs";
import { makeWebSearchOutput } from "./makeWebSearchOutput.js";
import type { WebSearchInput, WebSearchOutput } from "./types.js";

export async function performWebSearch(
    input: WebSearchInput,
    provider: Provider,
    model: Model,
    signal?: AbortSignal,
): Promise<WebSearchOutput> {
    const auxiliaryProvider = provider as Provider & {
        runClaudeAuxiliaryQuery?: (
            model: Model,
            request: {
                prompt: string;
                signal?: AbortSignal;
                systemPrompt: string;
                tools?: readonly "WebSearch"[];
            },
        ) => Promise<{ content: readonly unknown[] }>;
    };
    if (auxiliaryProvider.runClaudeAuxiliaryQuery === undefined) {
        throw new Error(
            `The selected provider '${provider.id}' does not support Claude web helper inference.`,
        );
    }
    const startedAt = performance.now();
    const response = await auxiliaryProvider.runClaudeAuxiliaryQuery(model, {
        prompt: makeSearchPrompt(input),
        ...(signal === undefined ? {} : { signal }),
        systemPrompt: "You are an assistant for performing a web search tool use.",
        tools: ["WebSearch"],
    });

    return makeWebSearchOutput(
        response.content as BetaContentBlock[],
        input.query,
        (performance.now() - startedAt) / 1000,
    );
}

function makeSearchPrompt(input: WebSearchInput): string {
    const filters = [
        input.allowed_domains === undefined
            ? undefined
            : `Only include these domains: ${input.allowed_domains.join(", ")}`,
        input.blocked_domains === undefined
            ? undefined
            : `Exclude these domains: ${input.blocked_domains.join(", ")}`,
    ].filter(Boolean);
    return [`Perform a web search for the query: ${input.query}`, ...filters].join("\n");
}
