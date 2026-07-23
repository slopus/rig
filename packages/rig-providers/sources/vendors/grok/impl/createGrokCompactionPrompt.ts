import { grok_compaction_prompt } from "@/vendors/grok/prompts/grok_compaction_prompt.js";

export function createGrokCompactionPrompt(instructions?: string): string {
    const context = instructions?.trim();
    if (context === undefined || context.length === 0) return grok_compaction_prompt;

    const marker = "\n\nCRITICAL:";
    const section =
        `\n\n**User-provided context for this compaction:**\n${context}\n\n` +
        "Please incorporate this context into your summary, ensuring it is prominently " +
        "addressed in the relevant sections.\n";
    return grok_compaction_prompt.replace(marker, `${section}${marker}`);
}
