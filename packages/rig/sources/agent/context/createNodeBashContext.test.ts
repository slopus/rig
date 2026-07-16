import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNodeBashContext } from "./createNodeBashContext.js";
import { createPermissionContext } from "../../permissions/index.js";
import {
    type ManagedProcess,
    NativeProxessManager,
    type ProcessRunResult,
} from "../../processes/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("createNodeBashContext", () => {
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
        } as unknown as NativeProxessManager;
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
        const processManager = new NativeProxessManager();
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
});

async function waitForSessionOutput(
    context: ReturnType<typeof createNodeBashContext>,
    sessionId: number,
    marker: string,
) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const snapshot = await context.readSession(sessionId, { waitMs: 20 });
        if (snapshot?.stdout.includes(marker)) return snapshot;
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
