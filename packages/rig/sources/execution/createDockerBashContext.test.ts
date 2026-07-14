import { PassThrough } from "node:stream";

import type Dockerode from "dockerode";
import { describe, expect, it, vi } from "vitest";

import { createPermissionContext } from "../permissions/index.js";
import { createDockerBashContext } from "./createDockerBashContext.js";
import type { DockerEnvironment } from "./DockerEnvironment.js";

describe("createDockerBashContext", () => {
    it("uses distinct pid files for contexts sharing a container", async () => {
        const fake = createFakeDockerEnvironment();
        const first = createDockerBashContext(
            fake.environment,
            createPermissionContext("full_access"),
        );
        const second = createDockerBashContext(
            fake.environment,
            createPermissionContext("full_access"),
        );

        await first.startSession({ command: "sleep 10" });
        await second.startSession({ command: "sleep 10" });

        const pidFiles = fake.foregroundCommands.map((command) => command.at(-1));
        expect(pidFiles).toHaveLength(2);
        expect(new Set(pidFiles).size).toBe(2);

        for (const stream of fake.foregroundStreams) stream.end();
        await Promise.all([
            first.readSession(1, { waitMs: 1_000 }),
            second.readSession(1, { waitMs: 1_000 }),
        ]);
    });

    it("applies the local backend's two-minute default to foreground runs", async () => {
        const fake = createFakeDockerEnvironment();
        const context = createDockerBashContext(
            fake.environment,
            createPermissionContext("full_access"),
        );
        const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

        try {
            const resultPromise = context.run({ command: "printf done" });
            await vi.waitFor(() => expect(fake.foregroundStreams).toHaveLength(1));

            expect(timeoutSpy.mock.calls.some(([, delay]) => delay === 120_000)).toBe(true);
            fake.foregroundStreams[0]?.end();
            await expect(resultPromise).resolves.toMatchObject({ timedOut: false });
        } finally {
            timeoutSpy.mockRestore();
        }
    });

    it("keeps unread output deltas when capped buffers evict older bytes", async () => {
        const fake = createFakeDockerEnvironment();
        const context = createDockerBashContext(
            fake.environment,
            createPermissionContext("full_access"),
        );
        await context.startSession({ command: "stream output", maxOutputBytes: 5 });
        const stream = fake.foregroundStreams[0];
        stream?.write("abcde");

        await vi.waitFor(async () =>
            expect(await context.readSession(1)).toMatchObject({ stdoutDelta: "abcde" }),
        );
        stream?.write("fg");
        await vi.waitFor(async () =>
            expect(await context.readSession(1)).toMatchObject({ stdoutDelta: "fg" }),
        );

        stream?.end();
        await context.readSession(1, { waitMs: 1_000 });
    });

    it("handles container lookup failures while aborting a foreground run", async () => {
        const fake = createFakeDockerEnvironment();
        let containerRequests = 0;
        const environment = {
            config: { workingDirectory: "/workspace" },
            container: async () => {
                containerRequests += 1;
                if (containerRequests === 1) return fake.container;
                throw new Error("Docker socket unavailable during abort.");
            },
        } as unknown as DockerEnvironment;
        const context = createDockerBashContext(
            environment,
            createPermissionContext("full_access"),
        );
        const controller = new AbortController();
        const resultPromise = context.run({ command: "sleep 10", signal: controller.signal });
        await vi.waitFor(() => expect(fake.foregroundStreams).toHaveLength(1));

        controller.abort();

        await expect(resultPromise).resolves.toMatchObject({
            stderr: "Docker socket unavailable during abort.",
        });
    });
});

function createFakeDockerEnvironment(): {
    container: Dockerode.Container;
    environment: DockerEnvironment;
    foregroundCommands: string[][];
    foregroundStreams: PassThrough[];
} {
    const foregroundCommands: string[][] = [];
    const foregroundStreams: PassThrough[] = [];
    const container = {
        async exec(options: { AttachStdin?: boolean; Cmd?: string[] }) {
            const stream = new PassThrough();
            if (options.AttachStdin === true) {
                foregroundCommands.push(options.Cmd ?? []);
                foregroundStreams.push(stream);
            } else {
                queueMicrotask(() => stream.end());
            }
            return {
                inspect: async () => ({ ExitCode: 0 }),
                start: async () => stream,
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
    return {
        container,
        environment: {
            config: { workingDirectory: "/workspace" },
            container: async () => container,
        } as unknown as DockerEnvironment,
        foregroundCommands,
        foregroundStreams,
    };
}
