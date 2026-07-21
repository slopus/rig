import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createNodeAgentContext } from "../agent/context/createNodeAgentContext.js";
import { NativeProcessManager } from "../processes/index.js";
import { handleHappySessionRpc } from "./handleHappySessionRpc.js";
import { resolveHappyRipgrepExecutable } from "./resolveHappyRipgrepExecutable.js";

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("handleHappySessionRpc", () => {
    it("runs Happy shell and file operations through Rig's permission-aware context", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "rig-happy-rpc-"));
        directories.push(cwd);
        const context = createNodeAgentContext({
            cwd,
            permissionMode: "workspace_write",
            processManager: new NativeProcessManager(),
        });
        let abortCalls = 0;
        const call = (method: string, params: unknown) =>
            handleHappySessionRpc({
                abort: async () => {
                    abortCalls += 1;
                    return { aborted: true };
                },
                context: () => context,
                method,
                params,
            });

        await expect(resolveHappyRipgrepExecutable(context)).resolves.not.toBe("rg");
        await expect(call("abort", undefined)).resolves.toEqual({ aborted: true });
        expect(abortCalls).toBe(1);

        const written = await call("writeFile", {
            content: Buffer.from("hello").toString("base64"),
            expectedHash: null,
            path: "note.txt",
        });
        expect(written).toMatchObject({ success: true, hash: expect.any(String) });
        await expect(call("readFile", { path: "note.txt" })).resolves.toEqual({
            content: Buffer.from("hello").toString("base64"),
            success: true,
        });
        await expect(call("bash", { command: "printf mobile-shell" })).resolves.toMatchObject({
            exitCode: 0,
            stdout: "mobile-shell",
            success: true,
        });
        await expect(
            call("ripgrep", { args: ["--fixed-strings", "hello", "note.txt"] }),
        ).resolves.toMatchObject({
            exitCode: 0,
            stdout: "hello\n",
            success: true,
        });

        context.permissions?.setMode("read_only");
        await expect(
            call("writeFile", {
                content: Buffer.from("blocked").toString("base64"),
                expectedHash: (written as { hash: string }).hash,
                path: "note.txt",
            }),
        ).rejects.toThrow("File changes are disabled in read-only mode");
    });
});
