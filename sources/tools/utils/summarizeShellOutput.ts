import type { Static } from "@sinclair/typebox";

import type { shellToolOutputSchema } from "./shell.js";
import { singleLineText } from "./singleLineText.js";
import { summarizeTextOutput } from "./summarizeTextOutput.js";

export function summarizeShellOutput(result: Static<typeof shellToolOutputSchema>): string {
    if (result.backgroundTaskId !== undefined) return "Command started in the background.";
    const suffix = result.timedOut
        ? " (timed out)"
        : result.exitCode !== null && result.exitCode !== 0
          ? ` (exit ${result.exitCode})`
          : "";
    const output = summarizeTextOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
    return singleLineText(`${output}${suffix}`);
}
