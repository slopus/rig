import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNodeBashContext } from "./createNodeBashContext.js";
import { MAX_ACTIVE_BASH_SESSIONS } from "./bashSessionLimits.js";
import { createPermissionContext } from "../../permissions/index.js";
import {
    type ManagedProcess,
    NativeProcessManager,
    type ProcessRunResult,
} from "../../processes/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("createNodeBashContext", () => {
    it("rejects background work beyond the active session limit", async () => {
        const cwd = await makeTempDir();
        const completion = new Promise<ProcessRunResult>(() => {});
        const process = {
            interrupt: vi.fn(),
            kill: vi.fn(),
            readOutput: vi.fn(() => ({
                aborted: false,
                command: "pending",
                cwd,
                exitCode: null,
                id: "pending",
                killed: false,
                pid: 1,
                signal: null,
                status: "running" as const,
                stderr: "",
                stderrDelta: "",
                stderrOffset: 0,
                stdout: "",
                stdoutDelta: "",
                stdoutOffset: 0,
                timedOut: false,
            })),
            wait: () => completion,
            writeStdin: vi.fn(),
        } as unknown as ManagedProcess;
        const start = vi.fn(() => process);
        const context = createNodeBashContext({
            cwd,
            permissions: createPermissionContext("full_access"),
            processManager: { start } as unknown as NativeProcessManager,
        });
        for (let index = 0; index < MAX_ACTIVE_BASH_SESSIONS; index += 1) {
            await context.startSession({ command: `pending-${String(index)}` });
        }

        await expect(context.startSession({ command: "one-too-many" })).rejects.toThrow(
            `No more than ${String(MAX_ACTIVE_BASH_SESSIONS)} background commands can run at once.`,
        );
        expect(start).toHaveBeenCalledTimes(MAX_ACTIVE_BASH_SESSIONS);
    });

    it.runIf(process.platform !== "win32")(
        "uses the system login shell for foreground and background commands",
        async () => {
            const cwd = await makeTempDir();
            const shell = join(cwd, "system-shell");
            await writeFile(
                shell,
                '#!/bin/sh\nif [ "$1" = "-lc" ]; then export RIG_LOGIN_SHELL_USED=1; fi\nshift\nexec /bin/sh -c "$1"\n',
            );
            await chmod(shell, 0o755);
            vi.stubEnv("SHELL", shell);
            const context = createNodeBashContext({
                cwd,
                permissions: createPermissionContext("full_access"),
                processManager: new NativeProcessManager(),
            });
            const command = '[ "$RIG_LOGIN_SHELL_USED" = 1 ] && printf LOGIN_SHELL_OK';

            await expect(context.run({ command })).resolves.toMatchObject({
                exitCode: 0,
                stdout: "LOGIN_SHELL_OK",
            });
            const sessionId = await context.startSession({ command });
            await expect(context.readSession(sessionId, { waitMs: 2_000 })).resolves.toMatchObject({
                exitCode: 0,
                status: "completed",
                stdout: "LOGIN_SHELL_OK",
            });
        },
    );

    it("observes background process completion only once across repeated polls", async () => {
        const cwd = await makeTempDir();
        let resolveCompletion!: (result: ProcessRunResult) => void;
        const completion = new Promise<ProcessRunResult>((resolve) => {
            resolveCompletion = resolve;
        });
        const completionThen = vi.spyOn(completion, "then");
        const result: ProcessRunResult = {
            aborted: false,
            command: "long-running",
            cwd,
            exitCode: 0,
            id: "process-1",
            killed: false,
            pid: 1,
            signal: null,
            status: "exited",
            stderr: "",
            stdout: "",
            timedOut: false,
        };
        const process = {
            async kill() {
                resolveCompletion(result);
            },
            readOutput(stdoutOffset: number, stderrOffset: number) {
                return {
                    ...result,
                    status: "running" as const,
                    stderrDelta: "",
                    stderrOffset,
                    stdoutDelta: "",
                    stdoutOffset,
                };
            },
            wait() {
                return completion;
            },
            writeStdin() {
                return false;
            },
        } as unknown as ManagedProcess;
        const processManager = {
            start() {
                return process;
            },
        } as unknown as NativeProcessManager;
        const context = createNodeBashContext({
            cwd,
            permissions: createPermissionContext("full_access"),
            processManager,
        });
        const sessionId = await context.startSession({ command: "long-running" });

        await context.readSession(sessionId, { waitMs: 1 });
        await context.readSession(sessionId, { waitMs: 1 });
        await context.readSession(sessionId, { waitMs: 1 });

        expect(completionThen).toHaveBeenCalledTimes(1);
        resolveCompletion(result);
        await completion;
    });

    it("continues returning background output after the retained buffer fills", async () => {
        const cwd = await makeTempDir();
        const processManager = new NativeProcessManager();
        const context = createNodeBashContext({
            cwd,
            permissions: createPermissionContext("full_access"),
            processManager,
        });
        const script = [
            'process.stdout.write("A".repeat(32) + "FIRST_MARKER\\n");',
            'process.stdin.once("data", () => {',
            '    process.stdout.write("SECOND_MARKER\\n");',
            "    process.exit(0);",
            "});",
        ].join(" ");
        const sessionId = await context.startSession({
            command: `${nodeBinary()} -e ${shellQuote(script)}`,
            maxOutputBytes: 16,
        });

        try {
            const first = await waitForSessionOutput(context, sessionId, "FIRST_MARKER");
            expect(first.stdout).toBe("AAAFIRST_MARKER\n");
            expect(first.stdoutDelta).toBe("AAAFIRST_MARKER\n");

            expect(context.supportsSessionInput).toBe(true);
            expect(await context.writeSession(sessionId, "continue\n")).toBe(true);
            const second = await waitForSessionOutput(context, sessionId, "SECOND_MARKER");
            expect(second.stdout).toBe("R\nSECOND_MARKER\n");
            expect(second.stdoutDelta).toBe("SECOND_MARKER\n");
        } finally {
            await context.killAllSessions?.();
        }
    });

    it("interrupts a running process without ending its shell session", async () => {
        const cwd = await makeTempDir();
        const processManager = new NativeProcessManager();
        const context = createNodeBashContext({
            cwd,
            permissions: createPermissionContext("full_access"),
            processManager,
        });
        const script = [
            'process.stdin.setEncoding("utf8");',
            'process.on("SIGINT", () => process.stdout.write("INTERRUPTED\\n"));',
            'process.stdin.on("data", (data) => {',
            "    process.stdout.write(`RECEIVED:${data.trim()}\\n`);",
            "    process.exit(0);",
            "});",
            'process.stdout.write("READY\\n");',
            "setInterval(() => {}, 1_000);",
        ].join(" ");
        const sessionId = await context.startSession({
            command: `${nodeBinary()} -e ${shellQuote(script)}`,
        });

        try {
            await waitForSessionOutput(context, sessionId, "READY");
            await expect(context.interruptSession?.(sessionId)).resolves.toBe(true);
            const interrupted = await waitForSessionOutput(context, sessionId, "INTERRUPTED");
            expect(interrupted.status).toBe("running");

            await expect(context.writeSession(sessionId, "continue\n")).resolves.toBe(true);
            const completed = await waitForSessionOutput(
                context,
                sessionId,
                "RECEIVED:continue",
                "completed",
            );
            expect(completed.status).toBe("completed");
            expect(completed.exitCode).toBe(0);
        } finally {
            await context.killAllSessions?.();
        }
    });
});

async function waitForSessionOutput(
    context: ReturnType<typeof createNodeBashContext>,
    sessionId: number,
    marker: string,
    status?: "completed" | "running",
) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const snapshot = await context.readSession(sessionId, { waitMs: 20 });
        if (
            snapshot?.stdout.includes(marker) &&
            (status === undefined || snapshot.status === status)
        ) {
            return snapshot;
        }
    }
    throw new Error(`Timed out waiting for ${marker}.`);
}

async function makeTempDir(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "rig-node-bash-"));
    tempDirs.push(path);
    return path;
}

function nodeBinary(): string {
    return shellQuote(process.execPath);
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
