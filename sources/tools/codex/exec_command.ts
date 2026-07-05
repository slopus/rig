import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { runShellCommand, shellOutputToText, shellToolOutputSchema, summarizeShellOutput } from "../utils/index.js";

export const codexExecCommandTool = defineTool({
  name: "exec_command",
  label: "exec_command",
  description: "Runs a command in a PTY, returning output or a session ID for ongoing interaction.",
  arguments: Type.Object({
    cmd: Type.String({ description: "Shell command to execute." }),
    workdir: Type.Optional(Type.String({ description: "Working directory for the command. Defaults to the turn cwd." })),
    tty: Type.Optional(Type.Boolean({ description: "True allocates a PTY for the command; false or omitted uses plain pipes." })),
    yield_time_ms: Type.Optional(Type.Number({ description: "Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms." })),
    max_output_tokens: Type.Optional(Type.Number({ description: "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy." })),
    shell: Type.Optional(Type.String({ description: "Shell binary to launch. Defaults to the user's default shell." })),
    login: Type.Optional(Type.Boolean({ description: "True runs the shell with -l/-i semantics; false disables them. Defaults to true." })),
  }),
  returnType: shellToolOutputSchema,
  execute: async ({ cmd, workdir, yield_time_ms, max_output_tokens }, context, execution) => {
    const options: Parameters<typeof runShellCommand>[1] = {
      maxOutputBytes: Math.max(4_000, (max_output_tokens ?? 10_000) * 4),
    };
    if (workdir !== undefined) options.cwd = workdir;
    if (yield_time_ms !== undefined) options.timeoutMs = yield_time_ms;
    if (execution.signal !== undefined) options.signal = execution.signal;
    return runShellCommand(cmd, options, context);
  },
  toLLM: shellOutputToText,
  toUI: (result) => summarizeShellOutput(result),
  locks: [],
});
