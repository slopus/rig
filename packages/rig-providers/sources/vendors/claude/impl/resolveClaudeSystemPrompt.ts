import { claude_fable_5_system_prompt } from "@/vendors/claude/prompts/claude_fable_5_system_prompt.js";
import { claude_opus_4_8_system_prompt } from "@/vendors/claude/prompts/claude_opus_4_8_system_prompt.js";
import { claude_sonnet_5_system_prompt } from "@/vendors/claude/prompts/claude_sonnet_5_system_prompt.js";

export function resolveClaudeSystemPrompt(model: string): string {
    const normalized = model.toLowerCase();
    if (normalized.includes("sonnet")) return claude_sonnet_5_system_prompt;
    if (normalized.includes("fable")) return claude_fable_5_system_prompt;
    return claude_opus_4_8_system_prompt;
}
