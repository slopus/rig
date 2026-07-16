import { isAbsolute, resolve } from "node:path";

import type {
    ManagedProcess,
    NativeProxessManager,
    ProcessRunResult,
} from "../../processes/index.js";
import type { PermissionContext } from "../../permissions/index.js";
import type { BashContext, BashSessionSnapshot } from "./BashContext.js";
import { assertCanUseCustomShell } from "./assertCanUseCustomShell.js";
import { createSandboxedCommand } from "./createSandboxedCommand.js";
import { createToolEnvironment } from "./createToolEnvironment.js";
import { createCommandEnvironment, type SessionSecretContext } from "../../secrets/index.js";

export interface CreateNodeBashContextOptions {
    cwd: string;
    processManager: NativeProxessManager;
    permissions: PermissionContext;
    secrets?: SessionSecretContext;
}

interface NodeBashSession {
    command: string;
    completion: Promise<ProcessRunResult>;
    cwd: string;
    process: ManagedProcess;
    result?: ProcessRunResult;
    sessionId: number;
    stderrOffset: number;
    stdoutOffset: number;
    timedOut: boolean;
    timeout?: NodeJS.Timeout;
}

const MAX_RETAINED_SESSIONS = 64;

export function createNodeBashContext(options: CreateNodeBashContextOptions): BashContext {
    const sessions = new Map<number, NodeBashSession>();
    let nextSessionId = 1;
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
            await new Promise<void>((resolveWait) => {
                let settled = false;
                let timer: NodeJS.Timeout | undefined;
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
            const command = await createSandboxedCommand({
                command: runOptions.command,
                cwd: options.cwd,
                mode: options.permissions.mode,
            });
            const processRunOptions: Parameters<NativeProxessManager["run"]>[0] = {
                command,
                cwd,
                env: createCommandEnvironment(
                    createToolEnvironment(options.permissions.mode),
                    options.secrets,
                    runOptions.secrets,
                ),
                ...(options.permissions.mode === "full_access" ||
                globalThis.process.platform === "win32"
                    ? {}
                    : { shell: "/bin/sh" }),
                timeoutMs: runOptions.timeoutMs ?? 120_000,
                maxOutputBytes: runOptions.maxOutputBytes ?? 512_000,
            };
            if (runOptions.signal !== undefined) processRunOptions.signal = runOptions.signal;
            if (runOptions.shell !== undefined) processRunOptions.shell = runOptions.shell;

            const result = await options.processManager.run(processRunOptions);
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
            };
        },
        async startSession(runOptions) {
            assertCanUseCustomShell(options.permissions.mode, runOptions.shell);
            const cwd = runCwd(runOptions.cwd);
            const command = await createSandboxedCommand({
                command: runOptions.command,
                cwd: options.cwd,
                mode: options.permissions.mode,
            });
            const process = options.processManager.start({
                cleanupProcessGroupOnExit: true,
                command,
                cwd,
                env: createCommandEnvironment(
                    createToolEnvironment(options.permissions.mode),
                    options.secrets,
                    runOptions.secrets,
                ),
                maxOutputBytes: runOptions.maxOutputBytes ?? 512_000,
                ...(runOptions.shell !== undefined
                    ? { shell: runOptions.shell }
                    : options.permissions.mode === "full_access" ||
                        globalThis.process.platform === "win32"
                      ? {}
                      : { shell: "/bin/sh" }),
            });
            const sessionId = nextSessionId;
            nextSessionId += 1;
            const session: NodeBashSession = {
                command: runOptions.command,
                completion: process.wait(),
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
            void session.completion.then((result) => {
                session.result = result;
                if (session.timeout !== undefined) clearTimeout(session.timeout);
                onActiveSessionCountChange?.(activeSessionCount());
            });
            if (sessions.size > MAX_RETAINED_SESSIONS) {
                const completed = [...sessions.values()].find(
                    (candidate) => candidate.result !== undefined,
                );
                if (completed !== undefined) sessions.delete(completed.sessionId);
            }
            return sessionId;
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
