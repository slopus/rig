import type { Bash } from "just-bash";

import type { BashContext, BashRunResult, BashSessionSnapshot } from "./BashContext.js";
import { capOutput } from "./capOutput.js";

interface JustBashSession {
    command: string;
    completion: Promise<BashRunResult>;
    controller: AbortController;
    cwd: string;
    killed: boolean;
    maxOutputBytes?: number;
    result?: BashRunResult;
    sessionId: number;
    stderrOffset: number;
    stdoutOffset: number;
    timedOut: boolean;
    timeout?: ReturnType<typeof setTimeout>;
}

const MAX_RETAINED_SESSIONS = 64;

export function createJustBashBashContext(bash: Bash, cwd: string): BashContext {
    const sessions = new Map<number, JustBashSession>();
    let nextSessionId = 1;
    const trimSessions = () => {
        while (sessions.size > MAX_RETAINED_SESSIONS) {
            const completed = [...sessions.values()].find(
                (session) => session.result !== undefined,
            );
            if (completed === undefined) return;
            sessions.delete(completed.sessionId);
        }
    };
    const readSession = async (
        sessionId: number,
        readOptions: Parameters<BashContext["readSession"]>[1] = {},
    ): Promise<BashSessionSnapshot | undefined> => {
        const session = sessions.get(sessionId);
        if (session === undefined) return undefined;
        const waitMs = Math.max(0, readOptions.waitMs ?? 0);
        if (session.result === undefined && waitMs > 0 && !readOptions.signal?.aborted) {
            await new Promise<void>((resolveWait) => {
                let settled = false;
                let timer: ReturnType<typeof setTimeout> | undefined;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    if (timer !== undefined) clearTimeout(timer);
                    readOptions.signal?.removeEventListener("abort", finish);
                    resolveWait();
                };
                timer = setTimeout(finish, waitMs);
                readOptions.signal?.addEventListener("abort", finish, { once: true });
                void session.completion.then(finish);
                if (readOptions.signal?.aborted) finish();
            });
        }
        const result = session.result;
        const stdout = result?.stdout ?? "";
        const stderr = result?.stderr ?? "";
        const stdoutDelta = stdout.slice(session.stdoutOffset);
        const stderrDelta = stderr.slice(session.stderrOffset);
        session.stdoutOffset = stdout.length;
        session.stderrOffset = stderr.length;
        return {
            command: session.command,
            cwd: session.cwd,
            exitCode: result?.exitCode ?? null,
            sessionId,
            status: result === undefined ? "running" : session.killed ? "killed" : "completed",
            stderr,
            stderrDelta,
            stdout,
            stdoutDelta,
            timedOut: session.timedOut,
        };
    };

    return {
        cwd,
        async killSession(sessionId) {
            const session = sessions.get(sessionId);
            if (session === undefined) return undefined;
            session.killed = true;
            session.controller.abort();
            await session.completion;
            return readSession(sessionId);
        },
        readSession,
        async run(runOptions) {
            const controller = new AbortController();
            const timeout =
                runOptions.timeoutMs === undefined
                    ? undefined
                    : setTimeout(() => controller.abort(), runOptions.timeoutMs);
            const abort = () => controller.abort();
            runOptions.signal?.addEventListener("abort", abort, { once: true });

            try {
                const result = await bash.exec(runOptions.command, {
                    cwd: runOptions.cwd ?? cwd,
                    signal: controller.signal,
                });
                return {
                    stdout: capOutput(result.stdout, runOptions.maxOutputBytes),
                    stderr: capOutput(result.stderr, runOptions.maxOutputBytes),
                    exitCode: result.exitCode,
                    timedOut: controller.signal.aborted,
                };
            } finally {
                if (timeout !== undefined) clearTimeout(timeout);
                runOptions.signal?.removeEventListener("abort", abort);
            }
        },
        async startSession(runOptions) {
            const controller = new AbortController();
            const sessionId = nextSessionId;
            nextSessionId += 1;
            const session: JustBashSession = {
                command: runOptions.command,
                completion: Promise.resolve({
                    exitCode: null,
                    stderr: "",
                    stdout: "",
                    timedOut: false,
                }),
                controller,
                cwd: runOptions.cwd ?? cwd,
                killed: false,
                ...(runOptions.maxOutputBytes === undefined
                    ? {}
                    : { maxOutputBytes: runOptions.maxOutputBytes }),
                sessionId,
                stderrOffset: 0,
                stdoutOffset: 0,
                timedOut: false,
            };
            session.completion = bash
                .exec(runOptions.command, {
                    cwd: session.cwd,
                    signal: controller.signal,
                })
                .then((result) => ({
                    stdout: capOutput(result.stdout, session.maxOutputBytes),
                    stderr: capOutput(result.stderr, session.maxOutputBytes),
                    exitCode: result.exitCode,
                    timedOut: session.timedOut,
                }))
                .catch((error: unknown) => ({
                    stdout: "",
                    stderr: error instanceof Error ? error.message : String(error),
                    exitCode: null,
                    timedOut: session.timedOut,
                }));
            sessions.set(sessionId, session);
            if (runOptions.timeoutMs !== undefined) {
                session.timeout = setTimeout(() => {
                    session.timedOut = true;
                    session.killed = true;
                    controller.abort();
                }, runOptions.timeoutMs);
            }
            void session.completion.then((result) => {
                session.result = result;
                if (session.timeout !== undefined) clearTimeout(session.timeout);
                trimSessions();
            });
            trimSessions();
            return sessionId;
        },
        supportsSessionInput: false,
        async writeSession() {
            return false;
        },
    };
}
