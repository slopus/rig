import { createCodexBedrockEnvironmentContext } from "./createCodexBedrockEnvironmentContext.js";
import { createCodexPermissionInstructions } from "./createCodexPermissionInstructions.js";
import { createSystemPrompt, type CreateSystemPromptOptions } from "./createSystemPrompt.js";
import { loadAgentsMdInstructions } from "./loadAgentsMdInstructions.js";
import { loadSkills } from "./skills/loadSkills.js";
import { formatCodexSkillsForPrompt } from "./skills/formatCodexSkillsForPrompt.js";
import { systemMessageToText } from "./systemMessageToText.js";
import { createSecretInstructions } from "../secrets/index.js";
import { computeProfileSystemPrompt } from "../profiles/impl/computeProfileSystemPrompt.js";
import { createProfilePromptContext } from "../profiles/impl/createProfilePromptContext.js";
import { resolveModelProfileForProvider } from "../profiles/impl/resolveModelProfileForProvider.js";
import type { PreambleMessage } from "../providers/types.js";

export interface ProviderPrompt {
    systemPrompt?: string;
    preamble?: readonly PreambleMessage[];
}

export async function createProviderPrompt(
    options: CreateSystemPromptOptions,
): Promise<ProviderPrompt> {
    const profile = resolveModelProfileForProvider(options.provider, options.model);
    if (profile?.providerType !== "bedrock" || profile.vendor !== "openai") {
        const systemPrompt = await createSystemPrompt(options);
        return systemPrompt === undefined ? {} : { systemPrompt };
    }

    const promptContext = await createProfilePromptContext({
        agentContext: options.context,
        ...(options.effort === undefined ? {} : { effort: options.effort }),
        model: options.model,
        profile,
        provider: options.provider,
    });
    const systemPrompt = computeProfileSystemPrompt(
        profile,
        promptContext,
        options.systemPrompt === undefined ? {} : { originalOverride: options.systemPrompt },
    );
    const developerParts: string[] = [];
    if (options.instructions !== undefined && options.instructions.length > 0) {
        developerParts.push(options.instructions);
    }
    for (const message of options.messages) {
        if (message.role === "system") developerParts.push(systemMessageToText(message));
    }
    const skillInstructions =
        options.systemPrompt === undefined
            ? formatCodexSkillsForPrompt(
                  await loadSkills(options.context.fs),
                  options.durableSkills ?? [],
              )
            : formatCodexSkillsForPrompt([], options.durableSkills ?? []);
    if (options.context.permissions !== undefined) {
        developerParts.push(createCodexPermissionInstructions(options.context.permissions.mode));
    }
    if (skillInstructions !== undefined) developerParts.push(skillInstructions);
    if (options.context.secrets !== undefined) {
        const secretInstructions = createSecretInstructions(options.context.secrets);
        if (secretInstructions !== undefined) developerParts.push(secretInstructions);
    }
    if (options.appendSystemPrompt !== undefined && options.appendSystemPrompt.length > 0) {
        developerParts.push(options.appendSystemPrompt);
    }

    const userContextParts: string[] = [];
    const agentsMdInstructions = await loadAgentsMdInstructions(options.context.fs);
    if (agentsMdInstructions !== undefined) userContextParts.push(agentsMdInstructions);
    userContextParts.push(createCodexBedrockEnvironmentContext(options.context));

    const preamble: PreambleMessage[] = [];
    if (developerParts.length > 0) {
        preamble.push({ role: "developer", content: developerParts });
    }
    preamble.push({ role: "user", content: userContextParts });
    return { systemPrompt, preamble };
}
