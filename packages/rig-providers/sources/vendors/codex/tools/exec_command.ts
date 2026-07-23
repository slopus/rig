import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const exec_command = {
    name: "exec_command",
    type: "local",
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
                Type.String({
                    description:
                        "Per-command sandbox override. Defaults to `use_default`; use `require_escalated` for unsandboxed execution.",
                    enum: ["use_default", "require_escalated"],
                }),
            ),
            shell: Type.Optional(
                Type.String({
                    description: "Shell binary to launch. Defaults to the user's default shell.",
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
} as const satisfies SessionTool;
