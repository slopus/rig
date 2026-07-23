import { read_only_permissions } from "@/vendors/codex/prompts/read_only_permissions.js";
import { apps_instructions } from "@/vendors/codex/prompts/apps_instructions.js";
import { plugins_instructions } from "@/vendors/codex/prompts/plugins_instructions.js";
import { multi_agent_instructions } from "@/vendors/codex/prompts/multi_agent_instructions.js";
import { multi_agent_disabled } from "@/vendors/codex/prompts/multi_agent_disabled.js";
import { codex_agent_instructions } from "@/vendors/codex/prompts/codex_agent_instructions.js";
import { codex_coding_agent_instructions } from "@/vendors/codex/prompts/codex_coding_agent_instructions.js";

export interface CodexPromptEnvelope {
    readonly instructions: string;
    readonly systemMessages: readonly (readonly string[])[];
}

const base = [read_only_permissions, apps_instructions] as const;
const collaboration = [[multi_agent_instructions], [multi_agent_disabled]] as const;
const prompts: Readonly<Record<string, CodexPromptEnvelope>> = {
    "gpt-5.5:websocket": {
        instructions: codex_coding_agent_instructions,
        systemMessages: [[read_only_permissions, apps_instructions, plugins_instructions]],
    },
    "gpt-5.5:sse": {
        instructions: codex_coding_agent_instructions,
        systemMessages: [[read_only_permissions, apps_instructions]],
    },
    "gpt-5.6-sol:websocket": {
        instructions: codex_agent_instructions,
        systemMessages: [
            [read_only_permissions, apps_instructions, plugins_instructions],
            ...collaboration,
        ],
    },
    "gpt-5.6-sol:sse": {
        instructions: codex_agent_instructions,
        systemMessages: [[...base], ...collaboration],
    },
    "gpt-5.6-terra:websocket": {
        instructions: codex_agent_instructions,
        systemMessages: [
            [read_only_permissions, apps_instructions, plugins_instructions],
            ...collaboration,
        ],
    },
    "gpt-5.6-terra:sse": {
        instructions: codex_agent_instructions,
        systemMessages: [[...base], ...collaboration],
    },
    "gpt-5.6-luna:websocket": {
        instructions: codex_agent_instructions,
        systemMessages: [[read_only_permissions, apps_instructions, plugins_instructions]],
    },
    "gpt-5.6-luna:sse": {
        instructions: codex_agent_instructions,
        systemMessages: [[...base]],
    },
};

export function codexCliPrompt(model: string, transport: "sse" | "websocket"): CodexPromptEnvelope {
    const prompt = prompts[`${model}:${transport}`];
    if (prompt === undefined) throw new Error(`No captured ${transport} prompt for '${model}'.`);
    return prompt;
}
