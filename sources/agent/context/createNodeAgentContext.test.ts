import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NativeProxessManager } from "../../processes/index.js";
import { createNodeAgentContext } from "./createNodeAgentContext.js";

const tempDirs: string[] = [];

describe("createNodeAgentContext", () => {
    afterEach(async () => {
        await Promise.all(
            tempDirs.splice(0).map((path) =>
                rm(path, {
                    recursive: true,
                    force: true,
                }),
            ),
        );
    });

    it("runs bash through the explicit process manager", async () => {
        const cwd = await makeTempDir();
        const processManager = new NativeProxessManager();
        const context = createNodeAgentContext({
            cwd,
            processManager,
        });

        const result = await context.bash.run({
            command: "printf 'context-process'",
            timeoutMs: 2_000,
            maxOutputBytes: 4_096,
        });

        expect(result.stdout).toBe("context-process");
        expect(result.exitCode).toBe(0);
        expect(processManager.activeCount()).toBe(0);
    });

    it("keeps yielded shell sessions alive for polling and stdin", async () => {
        const cwd = await makeTempDir();
        const processManager = new NativeProxessManager();
        const context = createNodeAgentContext({ cwd, processManager });
        const script = [
            'process.stdin.setEncoding("utf8")',
            'process.stdin.once("data", data => { process.stdout.write("received:" + data.trim()); process.exit(0) })',
        ].join(";");
        const sessionId = await context.bash.startSession({
            command: `${JSON.stringify(process.execPath)} -e '${script}'`,
            maxOutputBytes: 4_096,
        });

        await expect(context.bash.readSession(sessionId, { waitMs: 50 })).resolves.toMatchObject({
            sessionId,
            status: "running",
        });
        await expect(context.bash.writeSession(sessionId, "hello\n")).resolves.toBe(true);
        const completed = await context.bash.readSession(sessionId, { waitMs: 2_000 });

        expect(completed).toMatchObject({
            exitCode: 0,
            status: "completed",
            stdout: "received:hello",
            stdoutDelta: "received:hello",
        });
        await expect(context.bash.readSession(sessionId)).resolves.toMatchObject({
            stdout: "received:hello",
            stdoutDelta: "",
        });
        expect(processManager.activeCount()).toBe(0);
    });

    it("enforces hard timeouts for background shell sessions", async () => {
        const cwd = await makeTempDir();
        const processManager = new NativeProxessManager();
        const context = createNodeAgentContext({ cwd, processManager });
        const sessionId = await context.bash.startSession({
            command: `${JSON.stringify(process.execPath)} -e 'setInterval(() => undefined, 1000)'`,
            timeoutMs: 50,
        });

        await expect(context.bash.readSession(sessionId, { waitMs: 2_000 })).resolves.toMatchObject(
            {
                status: "killed",
                timedOut: true,
            },
        );
        expect(processManager.activeCount()).toBe(0);
    });

    it("enforces filesystem permissions across traversal and symlink escapes", async () => {
        const root = await makeWorkspaceRoot();
        const cwd = join(root, "workspace");
        const outside = join(root, "outside.txt");
        await mkdir(cwd);
        await writeFile(outside, "original");
        await symlink(outside, join(cwd, "outside-link"));
        await symlink(join(root, "missing-outside.txt"), join(cwd, "broken-outside-link"));
        const context = createNodeAgentContext({
            cwd,
            processManager: new NativeProxessManager(),
        });

        await context.fs.writeFile(join(cwd, "inside.txt"), "inside");
        await context.fs.writeFile("relative.txt", "relative");
        await expect(readFile(join(cwd, "relative.txt"), "utf8")).resolves.toBe("relative");
        await expect(
            context.fs.writeFile(join(cwd, "..", "escaped.txt"), "escape"),
        ).rejects.toThrow("outside");
        await expect(context.fs.writeFile(join(cwd, "outside-link"), "escape")).rejects.toThrow(
            "outside",
        );
        await expect(
            context.fs.writeFile(join(cwd, "broken-outside-link"), "escape"),
        ).rejects.toThrow("outside");

        context.permissions?.setMode("read_only");
        await expect(context.fs.writeFile(join(cwd, "blocked.txt"), "blocked")).rejects.toThrow(
            "read-only",
        );

        context.permissions?.setMode("full_access");
        await context.fs.writeFile(outside, "full access");
        expect(await readFile(outside, "utf8")).toBe("full access");
    });

    it("sandboxes shell writes unless Full access is selected", async () => {
        const root = await makeWorkspaceRoot();
        const cwd = join(root, "workspace");
        await mkdir(cwd);
        const context = createNodeAgentContext({
            cwd,
            processManager: new NativeProxessManager(),
        });

        const inside = await context.bash.run({ command: "printf inside > inside.txt" });
        const escaped = await context.bash.run({ command: "printf escaped > ../escaped.txt" });
        const escapedThroughCwd = await context.bash.run({
            command: "printf escaped > escaped-cwd.txt",
            cwd: root,
        });
        expect(inside.exitCode).toBe(0);
        expect(escaped.exitCode).not.toBe(0);
        expect(escapedThroughCwd.exitCode).not.toBe(0);
        await expect(readFile(join(cwd, "inside.txt"), "utf8")).resolves.toBe("inside");
        await expect(readFile(join(root, "escaped.txt"), "utf8")).rejects.toThrow();
        await expect(readFile(join(root, "escaped-cwd.txt"), "utf8")).rejects.toThrow();

        context.permissions?.setMode("read_only");
        const readOnly = await context.bash.run({ command: "printf blocked > blocked.txt" });
        expect(readOnly.exitCode).not.toBe(0);

        context.permissions?.setMode("full_access");
        const fullAccess = await context.bash.run({ command: "printf allowed > ../allowed.txt" });
        expect(fullAccess.exitCode).toBe(0);
        await expect(readFile(join(root, "allowed.txt"), "utf8")).resolves.toBe("allowed");
    });

    it("blocks shell network access unless Full access is selected", async () => {
        const cwd = await makeTempDir();
        const context = createNodeAgentContext({
            cwd,
            processManager: new NativeProxessManager(),
        });
        const server = createServer((socket) => {
            socket.on("error", () => undefined);
            socket.end("connected");
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        try {
            const address = server.address() as AddressInfo;
            const script = [
                `const socket = require("node:net").connect(${address.port}, "127.0.0.1")`,
                "socket.setTimeout(1000)",
                'socket.on("connect", () => process.exit(0))',
                'socket.on("error", () => process.exit(2))',
                'socket.on("timeout", () => process.exit(3))',
            ].join(";");
            const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;

            const sandboxed = await context.bash.run({ command, timeoutMs: 3_000 });
            expect(sandboxed.exitCode).not.toBe(0);

            context.permissions?.setMode("full_access");
            const fullAccess = await context.bash.run({ command, timeoutMs: 3_000 });
            expect(fullAccess.exitCode).toBe(0);
        } finally {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error === undefined ? resolve() : reject(error)));
            });
        }
    });
});

async function makeTempDir(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "rig-context-"));
    tempDirs.push(path);
    return path;
}

async function makeWorkspaceRoot(): Promise<string> {
    const path = await mkdtemp(join(process.cwd(), ".rig-context-"));
    tempDirs.push(path);
    return path;
}
