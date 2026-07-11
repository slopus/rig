import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import {
    runShellCommand,
    shellOutputToText,
    shellToolOutputSchema,
    summarizeShellOutput,
} from "../utils/index.js";

export const claudeBashTool = defineTool({
    name: "Bash",
    label: "Bash",
    description: "Run shell command",
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
        dangerouslyDisableSandbox: Type.Optional(
            Type.Boolean({
                description:
                    "Request reviewed execution outside the workspace sandbox in Auto mode. Use only when the sandbox blocks a necessary command.",
            }),
        ),
    }),
    returnType: shellToolOutputSchema,
    execute: async ({ command, run_in_background, timeout }, context, execution) => {
        if (run_in_background === true) {
            const sessionId = await context.bash.startSession({
                command,
                timeoutMs: timeout ?? 120_000,
            });
            return {
                backgroundTaskId: String(sessionId),
                exitCode: null,
                stderr: "",
                stdout: "",
                timedOut: false,
            };
        }
        const options: Parameters<typeof runShellCommand>[1] = {};
        if (timeout !== undefined) options.timeoutMs = timeout;
        if (execution.onProgress !== undefined) options.onProgress = execution.onProgress;
        if (execution.signal !== undefined) options.signal = execution.signal;
        return runShellCommand(command, options, context);
    },
    toLLM: shellOutputToText,
    toUI: (result) => summarizeShellOutput(result),
    locks: [],
});
