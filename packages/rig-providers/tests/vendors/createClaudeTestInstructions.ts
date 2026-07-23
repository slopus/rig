import { renderClaudeSystemPrompt } from "@/vendors/claude/impl/renderClaudeSystemPrompt.js";
import { claude_fable_5_system_prompt } from "@/vendors/claude/prompts/claude_fable_5_system_prompt.js";
import { claude_opus_4_8_system_prompt } from "@/vendors/claude/prompts/claude_opus_4_8_system_prompt.js";
import { claude_sonnet_5_system_prompt } from "@/vendors/claude/prompts/claude_sonnet_5_system_prompt.js";

const TRACE_INSTRUCTIONS =
    "This is a deterministic provider trace. Follow exact reply and tool instructions.";

export function createClaudeTestInstructions(
    model: string,
    options: { cwd: string; env: NodeJS.ProcessEnv },
): string {
    const normalized = model.toLowerCase();
    const prompt = normalized.includes("sonnet")
        ? claude_sonnet_5_system_prompt
        : normalized.includes("fable")
          ? claude_fable_5_system_prompt
          : claude_opus_4_8_system_prompt;
    return `${renderClaudeSystemPrompt(prompt, options)}\n\n${TRACE_INSTRUCTIONS}`;
}
