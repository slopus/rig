import type { AgentContext } from "./context/AgentContext.js";
import { createAvailableModelsInstructions } from "./createAvailableModelsInstructions.js";
import { createPermissionInstructions } from "./createPermissionInstructions.js";
import { loadAgentsMdInstructions } from "./loadAgentsMdInstructions.js";
import { loadSkillInstructions } from "./skills/loadSkillInstructions.js";
import { formatSkillsForPrompt } from "./skills/formatSkillsForPrompt.js";
import { systemMessageToText } from "./systemMessageToText.js";
import type { AnyDefinedTool, Message } from "./types.js";
import type { Model, Provider } from "@slopus/rig-execution";
import { createSecretInstructions } from "../secrets/index.js";
import type { DurableSkillDefinition } from "../external-skills/types.js";
import { RIG_AGENT_TOOL_INSTRUCTIONS } from "./rigAgentToolInstructions.js";

export interface CreateSystemPromptOptions {
    appendSystemPrompt?: string;
    /** Exact integration-owned prompt. When present, Rig's assembled prompt is replaced. */
    systemPrompt?: string;
    provider: Provider;
    model: Model;
    instructions?: string;
    messages: readonly Message[];
    context: AgentContext;
    tools?: readonly AnyDefinedTool[];
    durableSkills?: readonly DurableSkillDefinition[];
    effort?: string;
}

export async function createSystemPrompt(
    options: CreateSystemPromptOptions,
): Promise<string | undefined> {
    const parts: string[] = [];

    if (options.instructions !== undefined && options.instructions.length > 0) {
        parts.push(options.instructions);
    }

    for (const message of options.messages) {
        if (message.role === "system") {
            parts.push(systemMessageToText(message));
        }
    }

    const agentsMdInstructions = await loadAgentsMdInstructions(options.context.fs);
    if (agentsMdInstructions !== undefined) {
        parts.push(agentsMdInstructions);
    }

    const skillInstructions = await loadSkillInstructions(
        options.context.fs,
        options.durableSkills ?? [],
    );
    if (skillInstructions !== undefined) {
        parts.push(skillInstructions);
    }

    if (options.context.subagents?.canSpawn === true) {
        const availableModelsInstructions = createAvailableModelsInstructions(
            options.context.subagents.availableModels ?? [],
            options.context.subagents.disabledProviders ?? [],
        );
        if (availableModelsInstructions !== undefined) {
            parts.push(availableModelsInstructions);
        }
    }

    if (options.tools?.some((tool) => tool.namespace?.name === "rig") === true) {
        parts.push(RIG_AGENT_TOOL_INSTRUCTIONS);
    }

    if (options.context.permissions !== undefined) {
        parts.push(
            createPermissionInstructions(options.context.permissions.mode, options.tools ?? []),
        );
    }

    if (options.context.secrets !== undefined) {
        const secretInstructions = createSecretInstructions(options.context.secrets);
        if (secretInstructions !== undefined) parts.push(secretInstructions);
    }

    if (options.appendSystemPrompt !== undefined && options.appendSystemPrompt.length > 0) {
        parts.push(options.appendSystemPrompt);
    }

    return parts.length > 0 ? parts.join("\n\n") : undefined;
}
