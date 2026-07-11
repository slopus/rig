import { Type, type Static } from "@sinclair/typebox";

import type { AgentContext } from "../../agent/context/AgentContext.js";
import type { ContentBlock } from "../../agent/types.js";
import { readSessionWithProgress } from "./readSessionWithProgress.js";

export const shellToolOutputSchema = Type.Object({
    backgroundTaskId: Type.Optional(Type.String()),
    stdout: Type.String(),
    stderr: Type.String(),
    exitCode: Type.Union([Type.Number(), Type.Null()]),
    timedOut: Type.Boolean(),
});

export interface RunCommandOptions {
    command: string;
    args?: readonly string[];
    cwd?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
    onProgress?: (display: string) => void;
    signal?: AbortSignal;
}

export interface RunCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
}

export async function runShellCommand(
    command: string,
    options: Omit<RunCommandOptions, "command" | "args"> = {},
    context: AgentContext,
): Promise<RunCommandResult> {
    const runOptions: Parameters<AgentContext["bash"]["run"]>[0] = {
        command,
        cwd: options.cwd ?? context.bash.cwd,
    };
    if (options.timeoutMs !== undefined) runOptions.timeoutMs = options.timeoutMs;
    if (options.maxOutputBytes !== undefined) runOptions.maxOutputBytes = options.maxOutputBytes;
    if (options.signal !== undefined) runOptions.signal = options.signal;
    if (options.onProgress !== undefined) {
        const { signal: _signal, ...sessionOptions } = runOptions;
        const sessionId = await context.bash.startSession(sessionOptions);
        const abort = () => void context.bash.killSession(sessionId);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        try {
            const snapshot = await readSessionWithProgress({
                bash: context.bash,
                onProgress: options.onProgress,
                sessionId,
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
            if (snapshot === undefined) throw new Error("The shell session was not found.");
            return {
                stdout: snapshot.stdout,
                stderr: snapshot.stderr,
                exitCode: snapshot.exitCode,
                timedOut: snapshot.timedOut,
            };
        } finally {
            options.signal?.removeEventListener("abort", abort);
        }
    }
    return context.bash.run(runOptions);
}

export async function runCommand(
    options: RunCommandOptions,
    context: AgentContext,
): Promise<RunCommandResult> {
    const runOptions: Parameters<AgentContext["bash"]["run"]>[0] = {
        command: [options.command, ...(options.args ?? []).map(shellQuote)].join(" "),
        cwd: options.cwd ?? context.bash.cwd,
    };
    if (options.timeoutMs !== undefined) runOptions.timeoutMs = options.timeoutMs;
    if (options.maxOutputBytes !== undefined) runOptions.maxOutputBytes = options.maxOutputBytes;
    if (options.signal !== undefined) runOptions.signal = options.signal;
    return context.bash.run(runOptions);
}

function shellQuote(value: string): string {
    if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
        return value;
    }

    return `'${value.replaceAll("'", "'\\''")}'`;
}

export function shellOutputToText(
    result: Static<typeof shellToolOutputSchema>,
): readonly ContentBlock[] {
    if (result.backgroundTaskId !== undefined) {
        return [
            {
                type: "text",
                text: `Command running in background with task ID ${result.backgroundTaskId}. Use TaskOutput to read its output or TaskStop to stop it.`,
            },
        ];
    }
    const chunks = [
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        `exit_code: ${result.exitCode ?? "null"}`,
        result.timedOut ? "timed_out: true" : "",
    ].filter((chunk) => chunk.length > 0);
    return [{ type: "text", text: chunks.join("\n\n") }];
}
