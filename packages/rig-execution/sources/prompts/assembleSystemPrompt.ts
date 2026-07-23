import type { ExecutorModelProfile } from "@/ExecutorModelProfile.js";
import type { Identity } from "@/Identity.js";
import type { ExecutorEnvironment } from "@/prompts/ExecutorEnvironment.js";
import { assembleEnvironmentPrompt } from "@/prompts/assembleEnvironmentPrompt.js";

const IDENTITY_MARKER = "{{identity}}";
const NAME_MARKER = "{{name}}";

export function assembleSystemPrompt(options: {
    contextInstructions?: string;
    environment: ExecutorEnvironment;
    identity: Identity;
    profile: ExecutorModelProfile;
    profiles: readonly ExecutorModelProfile[];
    systemPrompt?: string;
}): string {
    const prompt = (options.systemPrompt ?? options.profile.prompt)
        .replaceAll(NAME_MARKER, options.identity.name.trim())
        .replace(IDENTITY_MARKER, options.identity.prompt.trim());
    const environment = assembleEnvironmentPrompt({
        environment: options.environment,
        profiles: options.profiles,
    });
    return [prompt, environment, options.contextInstructions]
        .filter((part): part is string => part !== undefined && part.length > 0)
        .join("\n\n");
}
