import { isAbsolute, resolve } from "node:path";

import {
    resolveSystemShell,
    type ManagedProcess,
    type NativeProcessManager,
    type ProcessRunResult,
} from "../../processes/index.js";
import type { PermissionContext } from "../../permissions/index.js";
import type { BashContext, BashSessionSnapshot } from "./BashContext.js";
import { assertCanUseCustomShell } from "./assertCanUseCustomShell.js";
import { createSandboxedCommand } from "./createSandboxedCommand.js";
import { createToolEnvironment } from "./createToolEnvironment.js";
import { waitForBashSessionCompletion } from "./waitForBashSessionCompletion.js";
import { MAX_ACTIVE_BASH_SESSIONS, MAX_RETAINED_BASH_SESSIONS } from "./bashSessionLimits.js";
import { createCommandEnvironment, type SessionSecretContext } from "../../secrets/index.js";

export interface CreateNodeBashContextOptions {
    cwd: string;
    processManager: NativeProcessManager;
    permissions: PermissionContext;
    secrets?: SessionSecretContext;
}

interface NodeBashSession {
    command: string;
    completionWaiters: Set<() => void>;
    cwd: string;
    process: ManagedProcess;
    result?: ProcessRunResult;
    sessionId: number;
    stderrOffset: number;
    stdoutOffset: number;
    timedOut: boolean;
    timeout?: NodeJS.Timeout;
}

export function createNodeBashContext(options: CreateNodeBashContextOptions): BashContext {
    const sessions = new Map<number, NodeBashSession>();
    let nextSessionId = 1;
    let pendingSessionStarts = 0;
    let onActiveSessionCountChange: ((count: number) => void) | undefined;
    const activeSessionCount = () =>
        [...sessions.values()].filter((session) => session.result === undefined).length;
    const activeSessions = () =>
        [...sessions.values()]
            .filter((session) => session.result === undefined)
            .map((session) => ({
                command: session.command,
                cwd: session.cwd,
                sessionId: session.sessionId,
                status: "running" as const,
            }));
    const reserveSessionStart = () => {
        if (activeSessionCount() + pendingSessionStarts >= MAX_ACTIVE_BASH_SESSIONS) {
            throw new Error(
                `No more than ${String(MAX_ACTIVE_BASH_SESSIONS)} background commands can run at once.`,
            );
        }
        pendingSessionStarts += 1;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            pendingSessionStarts -= 1;
        };
    };
    const runCwd = (cwd: string | undefined) =>
        cwd === undefined ? options.cwd : isAbsolute(cwd) ? cwd : resolve(options.cwd, cwd);

    const readSession = async (
        sessionId: number,
        readOptions: Parameters<BashContext["readSession"]>[1] = {},
    ): Promise<BashSessionSnapshot | undefined> => {
        const session = sessions.get(sessionId);
        if (session === undefined) return undefined;
        const waitMs = Math.max(0, readOptions.waitMs ?? 0);
        if (session.result === undefined && waitMs > 0 && !readOptions.signal?.aborted) {
            await waitForBashSessionCompletion(
                session.completionWaiters,
                waitMs,
                readOptions.signal,
            );
        }

        const processSnapshot = session.process.readOutput(
            session.stdoutOffset,
            session.stderrOffset,
        );
        session.stdoutOffset = processSnapshot.stdoutOffset;
        session.stderrOffset = processSnapshot.stderrOffset;
        return {
            command: session.command,
            cwd: session.cwd,
            exitCode: session.result?.exitCode ?? null,
            sessionId,
            status:
                session.result === undefined
                    ? "running"
                    : session.result.killed
                      ? "killed"
                      : "completed",
            stderr: processSnapshot.stderr,
            stderrDelta: processSnapshot.stderrDelta,
            stdout: processSnapshot.stdout,
            stdoutDelta: processSnapshot.stdoutDelta,
            timedOut: session.timedOut,
        };
    };

    return {
        activeSessionCount,
        activeSessions,
        cwd: options.cwd,
        async interruptSession(sessionId) {
            const session = sessions.get(sessionId);
            if (session === undefined) return undefined;
            return session.process.interrupt();
        },
        async killAllSessions() {
            const active = [...sessions.values()].filter((session) => session.result === undefined);
            await Promise.all(
                active.map((session) => session.process.kill("SIGTERM", { forceAfterMs: 500 })),
            );
            return active.length;
        },
        async killSession(sessionId) {
            const session = sessions.get(sessionId);
            if (session === undefined) return undefined;
            await session.process.kill("SIGTERM", { forceAfterMs: 500 });
            return readSession(sessionId);
        },
        readSession,
        async run(runOptions) {
            assertCanUseCustomShell(options.permissions.mode, runOptions.shell);
            const cwd = runCwd(runOptions.cwd);
            const shell = runOptions.shell ?? resolveSystemShell();
            const toolEnvironment = await createToolEnvironment(
                options.permissions.mode,
                globalThis.process.env,
                { cwd: options.cwd },
            );
            const sandboxedCommand = await createSandboxedCommand({
                command: runOptions.command,
                cwd: options.cwd,
                mode: options.permissions.mode,
                ...(toolEnvironment.PATH === undefined ? {} : { path: toolEnvironment.PATH }),
                shell,
            });
            const processRunOptions: Parameters<NativeProcessManager["run"]>[0] = {
                command: sandboxedCommand.command,
                cwd,
                env: createCommandEnvironment(toolEnvironment, options.secrets, runOptions.secrets),
                timeoutMs: runOptions.timeoutMs ?? 120_000,
                maxOutputBytes: runOptions.maxOutputBytes ?? 512_000,
            };
            if (sandboxedCommand.args !== undefined) {
                processRunOptions.args = sandboxedCommand.args;
            } else {
                processRunOptions.shell = shell;
            }
            if (runOptions.signal !== undefined) processRunOptions.signal = runOptions.signal;

            const result = await options.processManager.run(processRunOptions);
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
            };
        },
        async startSession(runOptions) {
            const releaseSessionStart = reserveSessionStart();
            try {
                assertCanUseCustomShell(options.permissions.mode, runOptions.shell);
                const cwd = runCwd(runOptions.cwd);
                const shell = runOptions.shell ?? resolveSystemShell();
                const toolEnvironment = await createToolEnvironment(
                    options.permissions.mode,
                    globalThis.process.env,
                    { cwd: options.cwd },
                );
                const sandboxedCommand = await createSandboxedCommand({
                    command: runOptions.command,
                    cwd: options.cwd,
                    mode: options.permissions.mode,
                    ...(toolEnvironment.PATH === undefined ? {} : { path: toolEnvironment.PATH }),
                    shell,
                });
                const processStartOptions: Parameters<NativeProcessManager["start"]>[0] = {
                    cleanupProcessGroupOnExit: true,
                    command: sandboxedCommand.command,
                    cwd,
                    env: createCommandEnvironment(
                        toolEnvironment,
                        options.secrets,
                        runOptions.secrets,
                    ),
                    maxOutputBytes: runOptions.maxOutputBytes ?? 512_000,
                };
                if (sandboxedCommand.args !== undefined) {
                    processStartOptions.args = sandboxedCommand.args;
                } else {
                    processStartOptions.shell = shell;
                }
                const process = options.processManager.start(processStartOptions);
                const completion = process.wait();
                const sessionId = nextSessionId;
                nextSessionId += 1;
                const session: NodeBashSession = {
                    command: runOptions.command,
                    completionWaiters: new Set(),
                    cwd,
                    process,
                    sessionId,
                    stderrOffset: 0,
                    stdoutOffset: 0,
                    timedOut: false,
                };
                sessions.set(sessionId, session);
                onActiveSessionCountChange?.(activeSessionCount());
                if (runOptions.timeoutMs !== undefined) {
                    session.timeout = setTimeout(() => {
                        session.timedOut = true;
                        void process.kill("SIGTERM", { forceAfterMs: 500 });
                    }, runOptions.timeoutMs);
                    session.timeout.unref();
                }
                void completion.then((result) => {
                    session.result = result;
                    if (session.timeout !== undefined) clearTimeout(session.timeout);
                    for (const finish of session.completionWaiters) finish();
                    onActiveSessionCountChange?.(activeSessionCount());
                });
                if (sessions.size > MAX_RETAINED_BASH_SESSIONS) {
                    const completed = [...sessions.values()].find(
                        (candidate) => candidate.result !== undefined,
                    );
                    if (completed !== undefined) sessions.delete(completed.sessionId);
                }
                return sessionId;
            } finally {
                releaseSessionStart();
            }
        },
        setActiveSessionCountListener(listener) {
            onActiveSessionCountChange = listener;
            listener?.(activeSessionCount());
        },
        supportsSessionInput: true,
        async writeSession(sessionId, data) {
            const session = sessions.get(sessionId);
            return session?.process.writeStdin(data) ?? false;
        },
    };
}
