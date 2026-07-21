import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { summarizeEscalatedShellAction } from "../../permissions/summarizeEscalatedShellAction.js";
import {
    boundShellOutput,
    runShellCommand,
    SHELL_CAPTURE_MAX_BYTES,
    SHELL_OUTPUT_MAX_BYTES,
    SHELL_OUTPUT_MAX_LINES,
    summarizeTextOutput,
    textOutputSchema,
    toTextBlocks,
} from "../utils/index.js";

export const piBashTool = defineTool({
    name: "bash",
    label: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to the last ${SHELL_OUTPUT_MAX_LINES} lines or ${SHELL_OUTPUT_MAX_BYTES / 1024}KB (whichever is hit first). Optionally provide a timeout in seconds.`,
    arguments: Type.Object({
        command: Type.String({ description: "Bash command to execute" }),
        timeout: Type.Optional(
            Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
        ),
        secrets: Type.Optional(
            Type.Array(Type.String(), {
                description:
                    "IDs of attached secret bundles to inject for this command. Use an empty array for none.",
            }),
        ),
        sandbox_permissions: Type.Optional(
            Type.Union([Type.Literal("use_default"), Type.Literal("require_escalated")], {
                description:
                    "Request reviewed execution outside the workspace sandbox in Auto mode. Defaults to use_default.",
            }),
        ),
        justification: Type.Optional(
            Type.String({
                description:
                    "Concise user-facing reason why sandbox escalation is needed. Use only with require_escalated.",
            }),
        ),
    }),
    returnType: textOutputSchema,
    autoPermissionInstructions:
        'For bash, request full-access execution with sandbox_permissions: "require_escalated" and include a concise justification. Keep sandbox_permissions at "use_default" or omit it for ordinary commands.',
    describeAutoPermissionAction: ({ command }, context) =>
        summarizeEscalatedShellAction({ command, cwd: context.fs.cwd }),
    shouldReviewInAutoMode: ({ sandbox_permissions }) =>
        sandbox_permissions === "require_escalated",
    shouldRunInFullAccessInAutoMode: ({ sandbox_permissions }) =>
        sandbox_permissions === "require_escalated",
    execute: async ({ command, secrets, timeout }, context, execution) => {
        const options: Parameters<typeof runShellCommand>[1] = {
            maxOutputBytes: SHELL_CAPTURE_MAX_BYTES,
        };
        if (secrets !== undefined) options.secrets = secrets;
        if (timeout !== undefined) options.timeoutMs = timeout * 1000;
        if (execution.onProgress !== undefined) options.onProgress = execution.onProgress;
        if (execution.signal !== undefined) options.signal = execution.signal;
        const result = await runShellCommand(command, options, context);
        const fullText = [result.stdout, result.stderr].filter(Boolean).join("\n") || "(no output)";
        const text = boundShellOutput(fullText);
        if (result.exitCode !== 0 && result.exitCode !== null) {
            throw new Error(`${text}\n\nCommand exited with code ${result.exitCode}`);
        }
        return { text };
    },
    toLLM: toTextBlocks,
    toUI: (result) => summarizeTextOutput(result.text),
    locks: [],
});
