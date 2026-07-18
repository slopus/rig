import type { FileSystemContext } from "../context/FileSystemContext.js";
import { formatSkillsForPrompt } from "./formatSkillsForPrompt.js";
import { loadSkills } from "./loadSkills.js";
import type { DurableSkillDefinition } from "../../external-skills/types.js";

export async function loadSkillInstructions(
    fs: FileSystemContext,
    durableSkills: readonly DurableSkillDefinition[] = [],
): Promise<string | undefined> {
    return formatSkillsForPrompt(await loadSkills(fs), durableSkills);
}
