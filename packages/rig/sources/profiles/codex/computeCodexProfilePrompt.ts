import type { CodexProfileArtifactDescriptor } from "./types.js";

const OFFICIAL_IDENTITY =
    "You are Codex, an agent based on GPT-5. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled.";
const OFFICIAL_SECONDARY_IDENTITY = "As Codex, you are an excellent communicator";
const RIG_SECONDARY_IDENTITY = "As Rig, you are an excellent communicator";

export function computeCodexProfilePrompt(
    goldenPrompt: string,
    target: CodexProfileArtifactDescriptor,
): string {
    if (!goldenPrompt.startsWith(`${OFFICIAL_IDENTITY}\n`)) {
        throw new Error("Codex base instructions no longer start with the expected identity.");
    }
    if (goldenPrompt.indexOf(OFFICIAL_IDENTITY, OFFICIAL_IDENTITY.length) !== -1) {
        throw new Error("Codex base instructions contain the official identity more than once.");
    }
    if (goldenPrompt.indexOf(OFFICIAL_SECONDARY_IDENTITY) === -1) {
        throw new Error("Codex base instructions no longer contain the secondary identity.");
    }
    if (
        goldenPrompt.indexOf(
            OFFICIAL_SECONDARY_IDENTITY,
            goldenPrompt.indexOf(OFFICIAL_SECONDARY_IDENTITY) + OFFICIAL_SECONDARY_IDENTITY.length,
        ) !== -1
    ) {
        throw new Error("Codex base instructions contain the secondary identity more than once.");
    }
    return `${target.identity}${goldenPrompt.slice(OFFICIAL_IDENTITY.length)}`.replace(
        OFFICIAL_SECONDARY_IDENTITY,
        RIG_SECONDARY_IDENTITY,
    );
}
