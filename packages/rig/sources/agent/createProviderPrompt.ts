import { createSystemPrompt, type CreateSystemPromptOptions } from "./createSystemPrompt.js";
import type { PreambleMessage } from "@slopus/rig-execution";

export interface ProviderPrompt {
    systemPrompt?: string;
    systemPromptOverride?: string;
    preamble?: readonly PreambleMessage[];
}

export async function createProviderPrompt(
    options: CreateSystemPromptOptions,
): Promise<ProviderPrompt> {
    const systemPrompt = await createSystemPrompt(options);
    return {
        ...(systemPrompt === undefined ? {} : { systemPrompt }),
        ...(options.systemPrompt === undefined
            ? {}
            : { systemPromptOverride: options.systemPrompt }),
    };
}
