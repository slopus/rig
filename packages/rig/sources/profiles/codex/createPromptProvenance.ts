import type { PromptProvenance } from "../impl/types.js";
import { readCodexProfileCapture } from "./readCodexProfileArtifact.js";

export function createCodexPromptProvenance(stem: string): PromptProvenance {
    const capture = readCodexProfileCapture(stem);
    return {
        client: "@openai/codex",
        version: `main@${capture.source.commit.slice(0, 12)}`,
        source: `${capture.source.path} at ${capture.source.commit}; official and computed prompts are adjacent artifacts`,
        captureMethod: capture.source.captureMethod,
        clientTools: capture.model.clientTools,
    };
}
