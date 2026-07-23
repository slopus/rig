import { describe, expect, it } from "vitest";

import { codex_agent_instructions, codexSkills, exec, tool_search } from "@/index.js";

describe("Codex reconstruction assets", () => {
    it("exports literal prompts, skills, and TypeBox tools from the provider package", () => {
        expect(codex_agent_instructions).toContain("You are Codex");
        expect(codexSkills.length).toBeGreaterThan(0);
        expect(exec.name).toBe("exec");
        expect(tool_search.parameters?.type).toBe("object");
    });
});
