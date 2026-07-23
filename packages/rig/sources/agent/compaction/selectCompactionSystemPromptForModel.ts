import type { Model } from "@slopus/rig-execution";

const DEFAULT_COMPACTION_SYSTEM_PROMPT = `Create a detailed continuation brief for a coding agent that will continue this conversation without access to the original history.

Preserve the user's requests and constraints, important technical facts, decisions and rationale, files examined or changed, concrete edits, commands and test results, errors and fixes, and all unfinished work. Distinguish completed work from pending work. Include exact identifiers, paths, and short code fragments when they are needed to continue accurately. Do not continue the work or address the user. Return only the continuation brief.`;

export function selectCompactionSystemPromptForModel(model: Model): string {
    void model;
    return DEFAULT_COMPACTION_SYSTEM_PROMPT;
}
