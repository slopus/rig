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
            path: "/developer/bin:/usr/bin",
            shell: "/bin/zsh",
        });

        if (process.platform === "darwin") {
            expect(result.command).toBe("/usr/bin/sandbox-exec");
            expect(result.args?.[0]).toBe("-p");
            expect(result.args?.[1]).toContain("(deny default)");
            expect(result.args?.[1]).toContain("(allow file-read*)");
            expect(result.args?.slice(-4)).toEqual([
                "--",
                "/bin/zsh",
                "-lc",
                `export PATH='/developer/bin:/usr/bin'\n${userCommand}`,
            ]);
            return;
        }

        if (process.platform === "linux") {
            expect(result.command).toBe("bwrap");
            expect(result.args).toContain("--ro-bind");
            expect(result.args).toContain("--unshare-net");
            expect(result.args?.slice(-4)).toEqual([
                "--",
                "/bin/zsh",
                "-lc",
                `export PATH='/developer/bin:/usr/bin'\n${userCommand}`,
            ]);
            return;
        }

        expect(result).toMatchObject({
            args: [
                expect.stringMatching(/cli\.js$/u),
                "--settings",
                expect.stringMatching(/\.json$/u),
                "-c",
                String.raw`'/bin/zsh' -lc 'export PATH='\''/developer/bin:/usr/bin'\''
node -e "console.log('\''quoted & safe'\'')"'`,
            ],
            command: process.execPath,
        });
    });

    it.runIf(process.platform !== "darwin" && process.platform !== "linux")(
        "materializes identical sandbox settings only once",
        async () => {
            const cwd = await mkdtemp(join(tmpdir(), "rig-sandbox-command-"));
            tempDirectories.push(cwd);
            const options = {
                command: "true",
                cwd,
                mode: "read_only" as const,
                shell: "/bin/zsh",
            };
            const first = await createSandboxedCommand(options);
            const configPath = first.args?.[2];
            expect(configPath).toEqual(expect.stringMatching(/\.json$/u));
            if (configPath === undefined)
                throw new Error("Sandbox settings path was not returned.");
            const oldTime = new Date(1_000);
            await utimes(configPath, oldTime, oldTime);
            const oldModificationTime = (await stat(configPath)).mtimeMs;

            await Promise.all([createSandboxedCommand(options), createSandboxedCommand(options)]);

            expect((await stat(configPath)).mtimeMs).toBe(oldModificationTime);
        },
    );

    it.runIf(process.platform === "darwin")(
        "grants workspace writes while protecting repository metadata",
        async () => {
            const cwd = await mkdtemp(join(process.cwd(), ".rig-seatbelt-command-"));
            tempDirectories.push(cwd);

            const result = await createSandboxedCommand({
                command: "true",
                cwd,
                mode: "workspace_write",
                shell: "/bin/zsh",
            });

            expect(result.command).toBe("/usr/bin/sandbox-exec");
            expect(result.args?.[1]).toContain("(allow file-read*)");
            expect(result.args?.[1]).toContain("(allow file-write*");
            expect(result.args).toContain(`-DWRITABLE_ROOT_0=${cwd}`);
            expect(result.args).toContain(`-DPROTECTED_WRITE_0=${join(cwd, ".git")}`);
            expect(result.args).toContain(`-DPROTECTED_WRITE_1=${join(cwd, ".agents")}`);
            expect(result.args).toContain(`-DPROTECTED_WRITE_2=${join(cwd, ".codex")}`);
        },
    );
});
