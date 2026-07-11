import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import {
    runShellCommand,
    summarizeTextOutput,
    textOutputSchema,
    toTextBlocks,
} from "../utils/index.js";

const DEFAULT_MAX_LINES = 2000;
const DEFAULT_MAX_BYTES = 50 * 1024;

export const piBashTool = defineTool({
    name: "bash",
    label: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    arguments: Type.Object({
        command: Type.String({ description: "Bash command to execute" }),
        timeout: Type.Optional(
            Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
        ),
    }),
    returnType: textOutputSchema,
    execute: async ({ command, timeout }, context, execution) => {
        const options: Parameters<typeof runShellCommand>[1] = { maxOutputBytes: 512_000 };
        if (timeout !== undefined) options.timeoutMs = timeout * 1000;
        if (execution.onProgress !== undefined) options.onProgress = execution.onProgress;
        if (execution.signal !== undefined) options.signal = execution.signal;
        const result = await runShellCommand(command, options, context);
        const text = [result.stdout, result.stderr].filter(Boolean).join("\n") || "(no output)";
        if (result.exitCode !== 0 && result.exitCode !== null) {
            throw new Error(`${text}\n\nCommand exited with code ${result.exitCode}`);
        }
        return { text };
    },
    toLLM: toTextBlocks,
    toUI: (result) => summarizeTextOutput(result.text),
    locks: [],
});
