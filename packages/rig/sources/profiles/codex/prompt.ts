import { createProfilePrompt } from "../impl/createProfilePrompt.js";
import type { ProfilePrompt } from "../impl/types.js";
import { codexUltraPromptAppend } from "./appends/codexUltraPromptAppend.js";
import { createCodexPromptProvenance } from "./createPromptProvenance.js";
import { readCodexProfilePrompt } from "./readCodexProfileArtifact.js";

export const GPT_5_6_SOL_SYSTEM_PROMPT = readCodexProfilePrompt("codex-gpt-5-6-sol");
export const GPT_5_6_TERRA_SYSTEM_PROMPT = readCodexProfilePrompt("codex-gpt-5-6-terra");
export const GPT_5_6_LUNA_SYSTEM_PROMPT = readCodexProfilePrompt("codex-gpt-5-6-luna");

export const gpt56SolPrompt = createProfilePrompt(
    GPT_5_6_SOL_SYSTEM_PROMPT,
    createCodexPromptProvenance("codex-gpt-5-6-sol"),
);
export const gpt56TerraPrompt = createProfilePrompt(
    GPT_5_6_TERRA_SYSTEM_PROMPT,
    createCodexPromptProvenance("codex-gpt-5-6-terra"),
);
export const gpt56LunaPrompt = createProfilePrompt(
    GPT_5_6_LUNA_SYSTEM_PROMPT,
    createCodexPromptProvenance("codex-gpt-5-6-luna"),
);
export const gpt56SolPromptWithUltra: ProfilePrompt = {
    ...gpt56SolPrompt,
    appends: [...gpt56SolPrompt.appends, codexUltraPromptAppend],
};
export const gpt56TerraPromptWithUltra: ProfilePrompt = {
    ...gpt56TerraPrompt,
    appends: [...gpt56TerraPrompt.appends, codexUltraPromptAppend],
};
