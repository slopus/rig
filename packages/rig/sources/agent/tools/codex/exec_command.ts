import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { summarizeEscalatedShellAction } from "../../../permissions/summarizeEscalatedShellAction.js";
import { summarizeTextOutput } from "../../../tools/utils/index.js";
import {
    createUnifiedExecOutput,
    formatUnifiedExecOutput,
    unifiedExecOutputSchema,
} from "./impl/unifiedExecOutput.js";
import { readSessionWithProgress } from "../../../tools/utils/readSessionWithProgress.js";
import { parseShellExplorationPresentation } from "../../../tools/utils/parseShellExplorationPresentation.js";

export const codexExecCommandTool = defineTool({
    name: "exec_command",
    label: "exec_command",
    description: "Runs a command, returning output or a session ID for ongoing interaction.",
    executorTool: {
        name: "exec_command",
        description:
            "Runs a command in a PTY, returning output or a session ID for ongoing interaction.",
        parameters: Type.Object(
            {
                cmd: Type.String({ description: "Shell command to execute." }),
                justification: Type.Optional(
                    Type.String({
                        description:
                            "User-facing approval question for `require_escalated`; omit otherwise.",
                    }),
                ),
                login: Type.Optional(
                    Type.Boolean({
                        description:
                            "True runs the shell with -l/-i semantics; false disables them. Defaults to true.",
                    }),
                ),
                max_output_tokens: Type.Optional(
                    Type.Number({
                        description:
                            "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.",
                    }),
                ),
                prefix_rule: Type.Optional(
                    Type.Array(Type.String(), {
                        description:
                            'Reusable approval prefix for `cmd`, only with `sandbox_permissions: "require_escalated"`; for example ["git", "pull"].',
                    }),
                ),
                sandbox_permissions: Type.Optional(
                    Type.Unsafe({
                        type: "string",
                        description:
                            "Per-command sandbox override. Defaults to `use_default`; use `require_escalated` for unsandboxed execution.",
                        enum: ["use_default", "require_escalated"],
                    }),
                ),
                shell: Type.Optional(
                    Type.String({
                        description:
                            "Shell binary to launch. Defaults to the user's default shell.",
                    }),
                ),
                tty: Type.Optional(
                    Type.Boolean({
                        description:
                            "True allocates a PTY for the command; false or omitted uses plain pipes.",
                    }),
                ),
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
            },
            { additionalProperties: false },
        ),
    },
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
        secrets: Type.Optional(
            Type.Array(Type.String(), {
                description:
                    "IDs of attached secret bundles to inject for this command. Use an empty array for none.",
            }),
        ),
        shell: Type.Optional(
            Type.String({
                description: "Shell binary to launch. Defaults to the system login shell.",
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
    autoPermissionInstructions:
        'For exec_command, request full-access execution with sandbox_permissions: "require_escalated" and include a concise justification. Keep sandbox_permissions at "use_default" or omit it for ordinary commands.',
    describeAutoPermissionAction: ({ cmd, shell, workdir }, context) =>
        summarizeEscalatedShellAction({
            command: cmd,
            cwd: workdir ?? context.fs.cwd,
            ...(shell === undefined ? {} : { shell }),
        }),
    shouldReviewInAutoMode: ({ sandbox_permissions }) =>
        sandbox_permissions === "require_escalated",
    shouldRunInFullAccessInAutoMode: ({ sandbox_permissions }) =>
        sandbox_permissions === "require_escalated",
    execute: async (
        { cmd, max_output_tokens, secrets, shell, workdir, yield_time_ms },
        context,
        execution,
    ) => {
        const startedAt = Date.now();
        const startOptions: Parameters<typeof context.bash.startSession>[0] = {
            command: cmd,
            maxOutputBytes: Math.max(4_000, (max_output_tokens ?? 10_000) * 4),
        };
        if (workdir !== undefined) startOptions.cwd = workdir;
        if (secrets !== undefined) startOptions.secrets = secrets;
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
    toCallPresentation: ({ cmd }) => parseShellExplorationPresentation(cmd),
    isError: (result) => result.exit_code !== undefined && result.exit_code !== 0,
    toLLM: (result) => [{ type: "text", text: formatUnifiedExecOutput(result) }],
    toPresentation: (result) => ({
        command: result.command ?? "",
        output: result.output,
        ...(result.session_id === undefined ? {} : { sessionId: result.session_id }),
        type: "exec_command",
    }),
    toUI: (result) => {
        const summary = summarizeTextOutput(result.output, "");
        if (result.exit_code !== undefined && result.exit_code !== 0) {
            return summary === ""
                ? `Command exited with code ${result.exit_code}.`
                : `Command exited with code ${result.exit_code}: ${summary}`;
        }
        if (result.session_id !== undefined) {
            return summary === ""
                ? "Command is still running in the background."
                : `Command is still running in the background. Output so far: ${summary}`;
        }
        if (summary !== "") return summary;
        return `Command finished${result.exit_code === undefined ? "." : ` with exit code ${result.exit_code}.`}`;
    },
    locks: [],
});
