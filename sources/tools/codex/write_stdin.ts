import { Type } from "@sinclair/typebox";

import { defineTool } from "../../agent/types.js";
import {
    createUnifiedExecOutput,
    formatUnifiedExecOutput,
    unifiedExecOutputSchema,
} from "./unifiedExecOutput.js";
import { readSessionWithProgress } from "../utils/readSessionWithProgress.js";

export const codexWriteStdinTool = defineTool({
    name: "write_stdin",
    label: "write_stdin",
    description: "Writes characters to an existing shell session and returns recent output.",
    arguments: Type.Object({
        session_id: Type.Number({ description: "Identifier of the running shell session." }),
        chars: Type.Optional(
            Type.String({
                description:
                    "Bytes to write to stdin. Defaults to empty, which polls without writing.",
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
    execute: async (
        { session_id, chars = "", yield_time_ms, max_output_tokens },
        context,
        execution,
    ) => {
        const startedAt = Date.now();
        let interrupted: Awaited<ReturnType<typeof context.bash.killSession>> = undefined;
        if (chars.includes("\u0003")) {
            interrupted = await context.bash.killSession(session_id);
            if (interrupted === undefined) throw new Error("The shell session was not found.");
        } else if (chars.length > 0) {
            if (!context.bash.supportsSessionInput) {
                throw new Error("This shell session does not support interactive input.");
            }
            const written = await context.bash.writeSession(session_id, chars);
            if (!written) throw new Error("The shell session is no longer accepting input.");
        }
        const defaultWaitMs = chars.length > 0 ? 250 : 5_000;
        const maximumWaitMs = chars.length > 0 ? 30_000 : 300_000;
        const snapshot =
            interrupted ??
            (await readSessionWithProgress({
                bash: context.bash,
                ...(execution.onProgress === undefined ? {} : { onProgress: execution.onProgress }),
                sessionId: session_id,
                ...(execution.signal === undefined ? {} : { signal: execution.signal }),
                waitMs: Math.max(0, Math.min(maximumWaitMs, yield_time_ms ?? defaultWaitMs)),
            }));
        if (snapshot === undefined) throw new Error("The shell session was not found.");
        return createUnifiedExecOutput(
            snapshot,
            (Date.now() - startedAt) / 1_000,
            max_output_tokens,
        );
    },
    toLLM: (result) => [{ type: "text", text: formatUnifiedExecOutput(result) }],
    toUI: (result, args) =>
        args.chars === undefined || args.chars.length === 0
            ? result.session_id === undefined
                ? "The shell command has finished."
                : "Checked the running shell command."
            : result.session_id === undefined
              ? "Sent input; the shell command has finished."
              : "Sent input to the running shell command.",
    locks: [],
});
