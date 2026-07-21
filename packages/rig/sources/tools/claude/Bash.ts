import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { summarizeEscalatedShellAction } from "../../permissions/summarizeEscalatedShellAction.js";
import {
    SHELL_CAPTURE_MAX_BYTES,
    SHELL_OUTPUT_MAX_BYTES,
    SHELL_OUTPUT_MAX_LINES,
    runShellCommand,
    shellOutputToText,
    shellToolOutputSchema,
    summarizeShellOutput,
} from "../utils/index.js";

export const claudeBashTool = defineTool({
    name: "Bash",
    label: "Bash",
    description: `Run a shell command. Output returned to Claude is truncated to the last ${SHELL_OUTPUT_MAX_LINES} lines or ${SHELL_OUTPUT_MAX_BYTES / 1024}KB.`,
    arguments: Type.Object({
        command: Type.String({ description: "The command to execute" }),
        timeout: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds" })),
        description: Type.Optional(
            Type.String({
                description:
                    'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.',
            }),
        ),
        run_in_background: Type.Optional(
            Type.Boolean({
                description:
                    "Set to true to run this command in the background. Use TaskOutput to read the output later.",
            }),
        ),
        secrets: Type.Optional(
            Type.Array(Type.String(), {
                description:
                    "IDs of attached secret bundles to inject for this command. Use an empty array for none.",
            }),
        ),
        dangerouslyDisableSandbox: Type.Optional(
            Type.Boolean({
                description:
                    "Request reviewed execution outside the workspace sandbox in Auto mode. Use only when the sandbox blocks a necessary command.",
            }),
        ),
    }),
    returnType: shellToolOutputSchema,
    autoPermissionInstructions:
        "For Bash, request full-access execution with dangerouslyDisableSandbox: true only when the workspace sandbox blocks necessary work. The command remains sandboxed when this field is false or omitted.",
    describeAutoPermissionAction: ({ command }, context) =>
        summarizeEscalatedShellAction({ command, cwd: context.fs.cwd }),
    shouldReviewInAutoMode: ({ dangerouslyDisableSandbox }) => dangerouslyDisableSandbox === true,
    shouldRunInFullAccessInAutoMode: ({ dangerouslyDisableSandbox }) =>
        dangerouslyDisableSandbox === true,
    execute: async ({ command, run_in_background, secrets, timeout }, context, execution) => {
        if (run_in_background === true) {
            const sessionId = await context.bash.startSession({
                command,
                maxOutputBytes: SHELL_CAPTURE_MAX_BYTES,
                ...(secrets === undefined ? {} : { secrets }),
                ...(timeout === undefined ? {} : { timeoutMs: timeout }),
            });
            return {
                backgroundTaskId: String(sessionId),
                exitCode: null,
                stderr: "",
                stdout: "",
                timedOut: false,
            };
        }
        const options: Parameters<typeof runShellCommand>[1] = {
            maxOutputBytes: SHELL_CAPTURE_MAX_BYTES,
        };
        if (secrets !== undefined) options.secrets = secrets;
        if (timeout !== undefined) options.timeoutMs = timeout;
        if (execution.onProgress !== undefined) options.onProgress = execution.onProgress;
        if (execution.signal !== undefined) options.signal = execution.signal;
        return runShellCommand(command, options, context);
    },
    toLLM: shellOutputToText,
    toUI: (result) => summarizeShellOutput(result),
    locks: [],
});
