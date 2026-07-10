import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { NativeProxessManager } from "./NativeProxessManager.js";

const tempDirs: string[] = [];

describe("NativeProxessManager", () => {
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

    it("runs a command with an explicit cwd and captures stdout and stderr", async () => {
        const cwd = await makeTempDir();
        const manager = new NativeProxessManager();

        const result = await manager.run({
            command: "printf 'hello'; printf 'warn' >&2",
            cwd,
            timeoutMs: 2_000,
            maxOutputBytes: 4_096,
        });

        expect(result.stdout).toBe("hello");
        expect(result.stderr).toBe("warn");
        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
        expect(manager.activeCount()).toBe(0);
    });

    it("keeps started processes tracked and writes stdin to them", async () => {
        const cwd = await makeTempDir();
        const manager = new NativeProxessManager();
        const script =
            "process.stdin.setEncoding('utf8'); process.stdin.on('data', data => { process.stdout.write(`seen:${data.trim()}`); process.exit(0); });";

        const process = manager.start({
            command: `${nodeBinary()} -e ${shellQuote(script)}`,
            cwd,
            maxOutputBytes: 4_096,
        });

        expect(manager.activeCount()).toBe(1);
        expect(process.writeStdin("input\n")).toBe(true);

        const result = await process.wait();
        expect(result.stdout).toBe("seen:input");
        expect(result.exitCode).toBe(0);
        expect(manager.activeCount()).toBe(0);
    });

    it("kills timed out commands and removes them from tracking", async () => {
        const cwd = await makeTempDir();
        const manager = new NativeProxessManager();

        const result = await manager.run({
            command: `${nodeBinary()} -e ${shellQuote("setInterval(() => undefined, 1000);")}`,
            cwd,
            timeoutMs: 50,
            killGraceMs: 50,
            maxOutputBytes: 4_096,
        });

        expect(result.timedOut).toBe(true);
        expect(result.killed).toBe(true);
        expect(manager.activeCount()).toBe(0);
    });

    it("kills commands when their abort signal fires", async () => {
        const cwd = await makeTempDir();
        const manager = new NativeProxessManager();
        const controller = new AbortController();
        const resultPromise = manager.run({
            command: `${nodeBinary()} -e ${shellQuote("setInterval(() => undefined, 1000);")}`,
            cwd,
            timeoutMs: 2_000,
            killGraceMs: 50,
            maxOutputBytes: 4_096,
            signal: controller.signal,
        });

        controller.abort();
        const result = await resultPromise;

        expect(result.aborted).toBe(true);
        expect(result.timedOut).toBe(false);
        expect(result.killed).toBe(true);
        expect(manager.activeCount()).toBe(0);
    });

    it("kills the process group for timed out shell descendants", async () => {
        const cwd = await makeTempDir();
        const marker = join(cwd, "descendant-marker.txt");
        const manager = new NativeProxessManager();
        const writer = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive"), 500);`;
        const blocker = "setInterval(() => undefined, 1000);";

        const result = await manager.run({
            command: `${nodeBinary()} -e ${shellQuote(writer)} & ${nodeBinary()} -e ${shellQuote(blocker)}`,
            cwd,
            timeoutMs: 100,
            killGraceMs: 50,
            maxOutputBytes: 4_096,
        });

        expect(result.timedOut).toBe(true);
        await delay(700);
        await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
        expect(manager.activeCount()).toBe(0);
    });
});

async function makeTempDir(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "rig-processes-"));
    tempDirs.push(path);
    return path;
}

function nodeBinary(): string {
    return shellQuote(process.execPath);
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
