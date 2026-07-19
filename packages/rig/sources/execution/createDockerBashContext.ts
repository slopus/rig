import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { PassThrough, type Duplex } from "node:stream";

import type Dockerode from "dockerode";

import type {
    BashContext,
    BashRunOptions,
    BashSessionSnapshot,
} from "../agent/context/BashContext.js";
import { assertCanUseCustomShell } from "../agent/context/assertCanUseCustomShell.js";
import type { PermissionContext } from "../permissions/index.js";
import type { DockerEnvironment } from "./DockerEnvironment.js";
import { runDockerExec } from "./runDockerExec.js";
import { readDockerEnvironmentVariableNames } from "./readDockerEnvironmentVariableNames.js";
import { createDockerCommandEnvironment, type SessionSecretContext } from "../secrets/index.js";
import { createDockerSandboxCommand } from "./createDockerSandboxCommand.js";
import { prepareDockerSandbox, type PreparedDockerSandbox } from "./prepareDockerSandbox.js";
import { resolveDockerPath } from "./resolveDockerPath.js";
import { DOCKER_PROTECTED_PATH_MONITOR_SCRIPT } from "./dockerProtectedPathMonitorScript.js";

interface DockerBashSession {
    command: string;
    completion: Promise<void>;
    cwd: string;
    exec: Dockerode.Exec;
    exitCode: number | null;
    finished: boolean;
    killed: boolean;
    pidFile: string;
    sessionId: number;
    stderr: Buffer;
    stderrOffset: number;
    stdout: Buffer;
    stdoutOffset: number;
    stream: Duplex;
    timedOut: boolean;
    timeout?: NodeJS.Timeout;
}

const MAX_RETAINED_SESSIONS = 64;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;

export function createDockerBashContext(
    environment: DockerEnvironment,
    permissions: PermissionContext,
    secrets?: SessionSecretContext,
): BashContext {
    const sessions = new Map<number, DockerBashSession>();
    const contextId = randomUUID();
    const cwd = environment.config.workingDirectory;
    let nextSessionId = 1;
    let onActiveSessionCountChange: ((count: number) => void) | undefined;
    let ambientEnvironmentVariables: Promise<readonly string[]> | undefined;
    let canonicalWorkspace: Promise<string> | undefined;
    let sandboxRuntime: Promise<PreparedDockerSandbox> | undefined;
    const activeSessionCount = () =>
        [...sessions.values()].filter((session) => !session.finished).length;

    const start = async (options: Omit<BashRunOptions, "signal">): Promise<DockerBashSession> => {
        const permissionMode = permissions.mode;
        assertCanUseCustomShell(permissionMode, options.shell);
        const sessionId = nextSessionId++;
        const runCwd = options.cwd === undefined ? cwd : posix.resolve(cwd, options.cwd);
        const shell = options.shell ?? "/bin/sh";
        const pidFile = `/tmp/rig-exec-${process.pid}-${contextId}-${sessionId}.pid`;
        const container = await environment.container();
        ambientEnvironmentVariables ??= readDockerEnvironmentVariableNames(container).catch(
            (error: unknown) => {
                ambientEnvironmentVariables = undefined;
                throw error;
            },
        );
        const secretEnvironment = createDockerCommandEnvironment(
            secrets,
            options.secrets,
            await ambientEnvironmentVariables,
        );
        const workspaceCwd =
            permissionMode === "full_access" ? undefined : await loadCanonicalWorkspace();
        const invokedCommand =
            permissionMode === "full_access"
                ? [shell, "-lc", options.command]
                : createDockerSandboxCommand({
                      command: options.command,
                      commandCwd: runCwd,
                      mode: permissionMode,
                      protectedPaths: [pidFile],
                      runtime: await loadSandboxRuntime(container),
                      shell,
                      workspaceCwd: workspaceCwd ?? cwd,
                  });
        const protectedCreatePaths =
            workspaceCwd === undefined || permissionMode === "read_only"
                ? []
                : [".git", ".agents", ".codex"].map((name) => posix.join(workspaceCwd, name));
        const exec = await container.exec({
            AttachStdin: true,
            AttachStderr: true,
            AttachStdout: true,
            Cmd:
                protectedCreatePaths.length === 0
                    ? [
                          "/bin/sh",
                          "-c",
                          'echo $$ > "$1"; shift; exec "$@"',
                          "rig",
                          pidFile,
                          ...invokedCommand,
                      ]
                    : [
                          "/bin/sh",
                          "-c",
                          DOCKER_PROTECTED_PATH_MONITOR_SCRIPT,
                          "rig",
                          pidFile,
                          ...protectedCreatePaths,
                          "--",
                          ...invokedCommand,
                      ],
            ...(Object.keys(secretEnvironment).length === 0
                ? {}
                : {
                      Env: Object.entries(secretEnvironment).map(
                          ([name, value]) => `${name}=${value ?? ""}`,
                      ),
                  }),
            Tty: false,
            WorkingDir: runCwd,
        });
        const stream = await exec.start({ hijack: true, stdin: true, Tty: false });
        const stdoutStream = new PassThrough();
        const stderrStream = new PassThrough();
        const maximum = options.maxOutputBytes ?? 512_000;
        const session: DockerBashSession = {
            command: options.command,
            completion: Promise.resolve(),
            cwd: runCwd,
            exec,
            exitCode: null,
            finished: false,
            killed: false,
            pidFile,
            sessionId,
            stderr: Buffer.alloc(0),
            stderrOffset: 0,
            stdout: Buffer.alloc(0),
            stdoutOffset: 0,
            stream,
            timedOut: false,
        };
        stdoutStream.on("data", (chunk: Buffer) => {
            const previousLength = session.stdout.length;
            session.stdout = appendCapped(session.stdout, chunk, maximum);
            const evictedBytes = previousLength + chunk.length - session.stdout.length;
            session.stdoutOffset = Math.max(0, session.stdoutOffset - evictedBytes);
        });
        stderrStream.on("data", (chunk: Buffer) => {
            const previousLength = session.stderr.length;
            session.stderr = appendCapped(session.stderr, chunk, maximum);
            const evictedBytes = previousLength + chunk.length - session.stderr.length;
            session.stderrOffset = Math.max(0, session.stderrOffset - evictedBytes);
        });
        container.modem.demuxStream(stream, stdoutStream, stderrStream);
        session.completion = new Promise<void>((resolve) => {
            let settled = false;
            const finish = async (error?: Error) => {
                if (settled) return;
                settled = true;
                if (error !== undefined) {
                    session.stderr = appendCapped(
                        session.stderr,
                        Buffer.from(error.message),
                        maximum,
                    );
                }
                session.exitCode = await exec
                    .inspect()
                    .then((details) => details.ExitCode)
                    .catch(() => null);
                session.finished = true;
                if (session.timeout !== undefined) clearTimeout(session.timeout);
                onActiveSessionCountChange?.(activeSessionCount());
                resolve();
            };
            stream.once("error", (error) => void finish(error));
            stream.once("end", () => void finish());
            stream.once("close", () => void finish());
        });
        sessions.set(sessionId, session);
        onActiveSessionCountChange?.(activeSessionCount());
        if (options.timeoutMs !== undefined) {
            session.timeout = setTimeout(() => {
                session.timedOut = true;
                requestKill(session);
            }, options.timeoutMs);
            session.timeout.unref();
        }
        if (sessions.size > MAX_RETAINED_SESSIONS) {
            const completed = [...sessions.values()].find((candidate) => candidate.finished);
            if (completed !== undefined) sessions.delete(completed.sessionId);
        }
        return session;
    };

    const loadSandboxRuntime = async (
        container: Dockerode.Container,
    ): Promise<PreparedDockerSandbox> => {
        if (sandboxRuntime === undefined) {
            const pending = prepareDockerSandbox(container);
            sandboxRuntime = pending;
            void pending.catch(() => {
                if (sandboxRuntime === pending) sandboxRuntime = undefined;
            });
        }
        return sandboxRuntime;
    };

    const loadCanonicalWorkspace = (): Promise<string> => {
        canonicalWorkspace ??= resolveDockerPath(environment, cwd).catch((error: unknown) => {
            canonicalWorkspace = undefined;
            throw error;
        });
        return canonicalWorkspace;
    };

    const kill = async (session: DockerBashSession): Promise<void> => {
        if (session.finished) return;
        session.killed = true;
        const container = await environment.container();
        await runDockerExec(container, [
            "/bin/sh",
            "-c",
            'pid=$(cat "$1" 2>/dev/null) || exit 0; kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true',
            "rig",
            session.pidFile,
        ]).catch(() => undefined);
        session.stream.end();
        await Promise.race([
            session.completion,
            new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ]);
        if (!session.finished) {
            await runDockerExec(container, [
                "/bin/sh",
                "-c",
                'pid=$(cat "$1" 2>/dev/null) || exit 0; kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true',
                "rig",
                session.pidFile,
            ]).catch(() => undefined);
            await Promise.race([
                session.completion,
                new Promise<void>((resolve) => setTimeout(resolve, 500)),
            ]);
        }
        if (!session.finished) {
            session.stream.destroy();
            await session.completion;
        }
    };

    const interrupt = async (session: DockerBashSession): Promise<boolean> => {
        if (session.finished) return false;
        const container = await environment.container();
        const result = await runDockerExec(container, [
            "/bin/sh",
            "-c",
            'pid=$(cat "$1" 2>/dev/null) || exit 1; kill -INT -- "-$pid" 2>/dev/null || kill -INT "$pid" 2>/dev/null',
            "rig",
            session.pidFile,
        ]);
        return result.exitCode === 0;
    };

    const requestKill = (session: DockerBashSession): void => {
        void kill(session).catch((error: unknown) => {
            session.stream.destroy(
                error instanceof Error
                    ? error
                    : new Error(`Could not stop Docker command: ${error}`),
            );
        });
    };

    const snapshot = (session: DockerBashSession): BashSessionSnapshot => {
        const stdoutDelta = session.stdout.subarray(session.stdoutOffset).toString("utf8");
        const stderrDelta = session.stderr.subarray(session.stderrOffset).toString("utf8");
        session.stdoutOffset = session.stdout.length;
        session.stderrOffset = session.stderr.length;
        return {
            command: session.command,
            cwd: session.cwd,
            exitCode: session.exitCode,
            sessionId: session.sessionId,
            status: session.finished
                ? session.killed || session.exitCode === null
                    ? "killed"
                    : "completed"
                : "running",
            stderr: session.stderr.toString("utf8"),
            stderrDelta,
            stdout: session.stdout.toString("utf8"),
            stdoutDelta,
            timedOut: session.timedOut,
        };
    };

    return {
        activeSessionCount,
        activeSessions: () =>
            [...sessions.values()]
                .filter((session) => !session.finished)
                .map((session) => ({
                    command: session.command,
                    cwd: session.cwd,
                    sessionId: session.sessionId,
                    status: "running" as const,
                })),
        cwd,
        async interruptSession(sessionId) {
            const session = sessions.get(sessionId);
            if (session === undefined) return undefined;
            return interrupt(session);
        },
        async killAllSessions() {
            const active = [...sessions.values()].filter((session) => !session.finished);
            await Promise.all(active.map(kill));
            return active.length;
        },
        async killSession(sessionId) {
            const session = sessions.get(sessionId);
            if (session === undefined) return undefined;
            await kill(session);
            return snapshot(session);
        },
        async readSession(sessionId, options = {}) {
            const session = sessions.get(sessionId);
            if (session === undefined) return undefined;
            const waitMs = Math.max(0, options.waitMs ?? 0);
            if (!session.finished && waitMs > 0 && !options.signal?.aborted) {
                await new Promise<void>((resolve) => {
                    let settled = false;
                    const finish = () => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        options.signal?.removeEventListener("abort", finish);
                        resolve();
                    };
                    const timer = setTimeout(finish, waitMs);
                    options.signal?.addEventListener("abort", finish, { once: true });
                    void session.completion.then(finish);
                });
            }
            return snapshot(session);
        },
        async run(options) {
            const { signal, ...startOptions } = options;
            const session = await start({
                ...startOptions,
                timeoutMs: startOptions.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
            });
            const abort = () => requestKill(session);
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
            try {
                await session.completion;
                const result = snapshot(session);
                return {
                    exitCode: result.exitCode,
                    stderr: result.stderr,
                    stdout: result.stdout,
                    timedOut: result.timedOut,
                };
            } finally {
                signal?.removeEventListener("abort", abort);
            }
        },
        setActiveSessionCountListener(listener) {
            onActiveSessionCountChange = listener;
            listener?.(activeSessionCount());
        },
        async startSession(options) {
            return (await start(options)).sessionId;
        },
        supportsSessionInput: true,
        async writeSession(sessionId, data) {
            const session = sessions.get(sessionId);
            if (session === undefined || session.finished || session.stream.destroyed) return false;
            return session.stream.write(data);
        },
    };
}

function appendCapped(current: Buffer, chunk: Buffer, maximum: number): Buffer {
    const combined = Buffer.concat([current, chunk]);
    return combined.length <= maximum ? combined : combined.subarray(combined.length - maximum);
}
