import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { summarizeTextOutput } from "../utils/index.js";
import {
    createUnifiedExecOutput,
    formatUnifiedExecOutput,
    unifiedExecOutputSchema,
} from "./unifiedExecOutput.js";
import { readSessionWithProgress } from "../utils/readSessionWithProgress.js";

export const codexExecCommandTool = defineTool({
    name: "exec_command",
    label: "exec_command",
    description: "Runs a command, returning output or a session ID for ongoing interaction.",
    arguments: Type.Object({
        cmd: Type.String({ description: "Shell command to execute." }),
        workdir: Type.Optional(
            Type.String({
                description: "Working directory for the command. Defaults to the turn cwd.",
            }),
        ),
        yield_time_ms: Type.Optional(
            Type.Number({
                description:
                    "Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms.",
            }),
        ),
        max_output_tokens: Type.Optional(
            Type.Number({
                description:
                    "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.",
            }),
        ),
        shell: Type.Optional(
            Type.String({
                description: "Shell binary to launch. Defaults to the user's default shell.",
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
    returnType: unifiedExecOutputSchema,
    execute: async (
        { cmd, max_output_tokens, shell, workdir, yield_time_ms },
        context,
        execution,
    ) => {
        const startedAt = Date.now();
        const startOptions: Parameters<typeof context.bash.startSession>[0] = {
            command: cmd,
            maxOutputBytes: Math.max(4_000, (max_output_tokens ?? 10_000) * 4),
        };
        if (workdir !== undefined) startOptions.cwd = workdir;
        if (shell !== undefined) startOptions.shell = shell;
        const sessionId = await context.bash.startSession(startOptions);
        const snapshot = await readSessionWithProgress({
            bash: context.bash,
            ...(execution.onProgress === undefined ? {} : { onProgress: execution.onProgress }),
            sessionId,
            ...(execution.signal === undefined ? {} : { signal: execution.signal }),
            waitMs: Math.max(250, Math.min(30_000, yield_time_ms ?? 10_000)),
        });
        if (snapshot === undefined) throw new Error("The shell session could not be started.");
        return createUnifiedExecOutput(
            snapshot,
            (Date.now() - startedAt) / 1_000,
            max_output_tokens,
        );
    },
    toLLM: (result) => [{ type: "text", text: formatUnifiedExecOutput(result) }],
    toUI: (result) => {
        const summary = summarizeTextOutput(result.output, "");
        if (summary !== "") return summary;
        return result.session_id === undefined
            ? `Command finished${result.exit_code === undefined ? "." : ` with exit code ${result.exit_code}.`}`
            : "Command is still running in the background.";
    },
    locks: [],
});
