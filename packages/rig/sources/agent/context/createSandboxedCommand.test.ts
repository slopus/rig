import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSandboxedCommand } from "./createSandboxedCommand.js";

const tempDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        tempDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("createSandboxedCommand", () => {
    it("passes the sandbox launcher and user command as direct process arguments", async () => {
        const userCommand = `node -e "console.log('quoted & safe')"`;

        const result = await createSandboxedCommand({
            command: userCommand,
            cwd: process.cwd(),
            mode: "read_only",
        });

        expect(result).toMatchObject({
            args: [
                expect.stringMatching(/cli\.js$/u),
                "--settings",
                expect.stringMatching(/\.json$/u),
                "-c",
                userCommand,
            ],
            command: process.execPath,
        });
    });

    it("materializes identical sandbox settings only once", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "rig-sandbox-command-"));
        tempDirectories.push(cwd);
        const options = { command: "true", cwd, mode: "read_only" as const };
        const first = await createSandboxedCommand(options);
        const configPath = first.args?.[2];
        expect(configPath).toEqual(expect.stringMatching(/\.json$/u));
        if (configPath === undefined) throw new Error("Sandbox settings path was not returned.");
        const oldTime = new Date(1_000);
        await utimes(configPath, oldTime, oldTime);
        const oldModificationTime = (await stat(configPath)).mtimeMs;

        await Promise.all([createSandboxedCommand(options), createSandboxedCommand(options)]);

        expect((await stat(configPath)).mtimeMs).toBe(oldModificationTime);
    });
});
