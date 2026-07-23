import { describe, expect, it } from "vitest";

import { claude_fable_5_system_prompt } from "@/prompts/claude/claude_fable_5_system_prompt.js";
import { claude_opus_4_8_system_prompt } from "@/prompts/claude/claude_opus_4_8_system_prompt.js";
import { claude_sonnet_5_system_prompt } from "@/prompts/claude/claude_sonnet_5_system_prompt.js";

describe("Claude system prompts", () => {
    it.each([
        claude_fable_5_system_prompt,
        claude_opus_4_8_system_prompt,
        claude_sonnet_5_system_prompt,
    ])("keeps the knowledge cutoff without captured environment data", (prompt) => {
        expect(prompt).toContain("Knowledge cutoff: January 2026.");
        expect(prompt).not.toContain("# Environment");
        expect(prompt).not.toContain("$CLAUDE_RUNTIME_");
    });
});
