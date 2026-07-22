import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import { quoteVisibleExact } from "../../permissions/quoteVisibleExact.js";
import {
    createUnifiedExecOutput,
    formatUnifiedExecOutput,
    unifiedExecOutputSchema,
} from "./unifiedExecOutput.js";
import { readSessionWithProgress } from "../utils/readSessionWithProgress.js";
import { summarizeTextOutput } from "../utils/index.js";
import { sendShellSessionInput } from "./sendShellSessionInput.js";

export const codexWriteStdinTool = defineTool({
    name: "write_stdin",
    label: "write_stdin",
    description:
        "Writes to an existing shell session and returns recent output. Use it for REPLs started by exec_command; end each cell with a newline.",
    arguments: Type.Object({
        session_id: Type.Number({ description: "Identifier of the running shell session." }),
        chars: Type.Optional(
            Type.String({
                description:
                    "Bytes to write to stdin. Ctrl-C requests an interrupt without terminating the shell session. Defaults to empty, which polls without writing.",
            }),
        ),
        yield_time_ms: Type.Optional(
            Type.Number({
                description:
                    "Wait before yielding output. Non-empty writes default to 250 ms; empty polls default to 5000 ms.",
            }),
        ),
        max_output_tokens: Type.Optional(
            Type.Number({
                description:
                    "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.",
            }),
        ),
    }),
    returnType: unifiedExecOutputSchema,
    describeAutoPermissionAction: ({ chars, session_id }) =>
        `sending ${quoteVisibleExact(chars ?? "")} to shell session ${String(session_id)}`,
    shouldReviewInAutoMode: ({ chars }) => chars !== undefined && chars.length > 0,
    execute: async (
        { session_id, chars = "", yield_time_ms, max_output_tokens },
        context,
        execution,
    ) => {
        const startedAt = Date.now();
        if (chars.length > 0) await sendShellSessionInput(context.bash, session_id, chars);
        const defaultWaitMs = chars.length > 0 ? 250 : 5_000;
        const maximumWaitMs = chars.length > 0 ? 30_000 : 300_000;
        const snapshot = await readSessionWithProgress({
            bash: context.bash,
            ...(execution.onProgress === undefined ? {} : { onProgress: execution.onProgress }),
            sessionId: session_id,
            ...(execution.signal === undefined ? {} : { signal: execution.signal }),
            waitMs: Math.max(0, Math.min(maximumWaitMs, yield_time_ms ?? defaultWaitMs)),
        });
        if (snapshot === undefined) throw new Error("The shell session was not found.");
        return createUnifiedExecOutput(
            snapshot,
            (Date.now() - startedAt) / 1_000,
            max_output_tokens,
        );
    },
    isError: (result) => result.exit_code !== undefined && result.exit_code !== 0,
    toLLM: (result) => [{ type: "text", text: formatUnifiedExecOutput(result) }],
    toPresentation: (result, args) => ({
        command: result.command ?? "",
        input: args.chars ?? "",
        sessionId: args.session_id,
        type: "background_terminal_interaction",
    }),
    toUI: (result, args) => {
        if (result.exit_code !== undefined && result.exit_code !== 0) {
            const summary = summarizeTextOutput(result.output, "");
            return summary === ""
                ? `Shell command exited with code ${result.exit_code}.`
                : `Shell command exited with code ${result.exit_code}: ${summary}`;
        }
        return args.chars === undefined || args.chars.length === 0
            ? result.session_id === undefined
                ? "The shell command has finished."
                : "Checked the running shell command."
            : result.session_id === undefined
              ? "Sent input; the shell command has finished."
              : "Sent input to the running shell command.";
    },
    locks: [],
});
