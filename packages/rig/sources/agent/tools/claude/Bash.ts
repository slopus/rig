import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { summarizeEscalatedShellAction } from "../../../permissions/summarizeEscalatedShellAction.js";
import {
    SHELL_CAPTURE_MAX_BYTES,
    SHELL_OUTPUT_MAX_BYTES,
    SHELL_OUTPUT_MAX_LINES,
    runShellCommand,
    shellOutputToText,
    shellToolOutputSchema,
    summarizeShellOutput,
} from "../../../tools/utils/index.js";
import { parseShellExplorationPresentation } from "../../../tools/utils/parseShellExplorationPresentation.js";

export const claudeBashTool = defineTool({
    name: "Bash",
    label: "Bash",
    description: `Executes a bash command and returns its output.

- Commands start in the session working directory. Shell state (such as \`cd\`, environment variables, and functions) does not persist between calls.
- Prefer the dedicated file and search tools over shell equivalents when one fits.
- \`timeout\` is in milliseconds: default 120000, max 600000.
- \`run_in_background\` runs the command detached: it keeps running across turns and re-invokes you when it exits. No \`&\` needed.

# Git
- Interactive flags such as \`git rebase -i\` and \`git add -i\` are not supported.
- Use the \`gh\` CLI for GitHub operations.
- Commit or push only when the user asks.

Rig extension: \`secrets\` injects selected session secret bundles. \`dangerouslyDisableSandbox\` requests one reviewed full-access execution in Auto mode; it never bypasses Read only or Workspace write mode.

Output is truncated to the last ${SHELL_OUTPUT_MAX_LINES} lines or ${SHELL_OUTPUT_MAX_BYTES / 1024}KB.`,
    arguments: Type.Object(
        {
            command: Type.String({ description: "The command to execute" }),
            timeout: Type.Optional(
                Type.Number({
                    description: "Optional timeout in milliseconds (max 600000)",
                    maximum: 600_000,
                    minimum: 0,
                }),
            ),
            description: Type.Optional(
                Type.String({
                    description:
                        'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description.',
                }),
            ),
            run_in_background: Type.Optional(
                Type.Boolean({
                    description: "Set to true to run this command in the background.",
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
        },
        { additionalProperties: false },
    ),
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
    toCallPresentation: ({ command, run_in_background }) =>
        run_in_background === true ? undefined : parseShellExplorationPresentation(command),
    toLLM: shellOutputToText,
    toUI: (result) => summarizeShellOutput(result),
    locks: [],
});
