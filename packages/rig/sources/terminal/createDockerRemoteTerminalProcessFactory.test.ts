import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { DockerEnvironment } from "../execution/DockerEnvironment.js";
import { createDockerRemoteTerminalProcessFactory } from "./createDockerRemoteTerminalProcessFactory.js";

describe("createDockerRemoteTerminalProcessFactory", () => {
    it("creates an interactive Docker TTY and forwards data, input, resize, and exit", async () => {
        const stream = new PassThrough();
        const resize = vi.fn(async () => undefined);
        const inspect = vi.fn(async () => ({ ExitCode: 4 }));
        const start = vi.fn(async () => stream);
        const exec = { inspect, resize, start };
        const controlCommands: unknown[] = [];
        const createExec = vi.fn(async (request: { Cmd?: unknown }) => {
            if (createExec.mock.calls.length === 1) return exec;
            controlCommands.push(request.Cmd);
            const control = new PassThrough();
            setImmediate(() => {
                control.end();
                stream.end();
            });
            return {
                inspect: async () => ({ ExitCode: 0 }),
                start: async () => control,
            };
        });
        const environment = {
            container: async () => ({
                exec: createExec,
                modem: {
                    demuxStream(source: PassThrough, stdout: PassThrough) {
                        source.pipe(stdout);
                    },
                },
            }),
        } as unknown as DockerEnvironment;
        const factory = createDockerRemoteTerminalProcessFactory(environment);

        const process = await factory.start({
            cols: 90,
            command: "echo ready",
            cwd: "/workspace",
            rows: 30,
            shell: "/bin/bash",
        });
        expect(createExec).toHaveBeenCalledWith(
            expect.objectContaining({
                Cmd: expect.arrayContaining(["/bin/bash", "-lc", "echo ready"]),
                Tty: true,
                WorkingDir: "/workspace",
            }),
        );
        expect(start).toHaveBeenCalledWith({ hijack: true, stdin: true, Tty: true });

        const output: string[] = [];
        stream.write("buffered");
        process.onData((data) => output.push(Buffer.from(data).toString("utf8")));
        stream.write("visible");
        expect(output).toEqual(["buffered", "visible"]);
        expect(await process.write("input")).toBe(true);
        await process.resize(100, 40);
        expect(resize).toHaveBeenCalledWith({ h: 40, w: 100 });

        await process.kill();
        await expect(process.wait()).resolves.toEqual({ exitCode: 4 });
        expect(JSON.stringify(controlCommands)).toContain("kill -TERM");
    });
});
