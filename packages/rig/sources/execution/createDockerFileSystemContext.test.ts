import { PassThrough } from "node:stream";

import type Dockerode from "dockerode";
import { describe, expect, it } from "vitest";

import { createPermissionContext } from "../permissions/index.js";
import { createDockerFileSystemContext } from "./createDockerFileSystemContext.js";
import type { DockerEnvironment } from "./DockerEnvironment.js";

describe("createDockerFileSystemContext", () => {
    it("restores modification times with a BusyBox-portable UTC touch command", async () => {
        const commands: string[][] = [];
        const container = {
            async exec(options: { Cmd?: string[] }) {
                commands.push(options.Cmd ?? []);
                return {
                    inspect: async () => ({ ExitCode: 0 }),
                    async start() {
                        const stream = new PassThrough();
                        queueMicrotask(() => stream.end());
                        return stream;
                    },
                };
            },
            modem: {
                demuxStream(
                    stream: NodeJS.ReadableStream,
                    stdout: NodeJS.WritableStream,
                    _stderr: NodeJS.WritableStream,
                ) {
                    stream.pipe(stdout);
                },
            },
        } as unknown as Dockerode.Container;
        const environment = {
            config: { workingDirectory: "/workspace" },
            container: async () => container,
        } as unknown as DockerEnvironment;
        const context = createDockerFileSystemContext(
            environment,
            createPermissionContext("full_access"),
        );

        await context.setModificationTime(
            "/workspace/file.txt",
            Date.parse("2026-07-14T07:14:29.097Z"),
        );

        expect(commands).toEqual([
            ["env", "TZ=UTC0", "touch", "-m", "-t", "202607140714.29", "--", "/workspace/file.txt"],
        ]);
    });
});
