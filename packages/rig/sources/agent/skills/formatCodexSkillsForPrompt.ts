import { readFileSync } from "node:fs";

import type { Skill } from "./Skill.js";
import type { DurableSkillDefinition } from "../../external-skills/types.js";

export function formatCodexSkillsForPrompt(
    skills: readonly Skill[],
    durableSkills: readonly DurableSkillDefinition[] = [],
): string | undefined {
    const lines = [
        ...skills.map(
            (skill) =>
                `- ${skill.name}: ${skill.description.slice(0, 1_024)} (file: ${skill.filePath})`,
        ),
        ...durableSkills.map(
            (skill) =>
                `- ${skill.name}: ${skill.description.slice(0, 1_024)} (environment resource: ${skill.location})`,
        ),
    ];
    if (lines.length === 0) return undefined;
    const template = readFileSync(
        new URL("../../profiles/codex/codex-skills-instructions.template.md", import.meta.url),
        "utf8",
    );
    return template.replace("{{SKILLS}}", lines.join("\n")).trimEnd();
}
