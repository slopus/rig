import { PassThrough } from "node:stream";

import type Dockerode from "dockerode";
import { describe, expect, it, vi } from "vitest";

import { runDockerExec } from "./runDockerExec.js";

describe("runDockerExec", () => {
    it("retains the configured tail without repeated whole-buffer concatenation", async () => {
        const stream = new PassThrough();
        const resultPromise = runDockerExec(createContainer(stream), ["emit"], {
            maxOutputBytes: 5,
        });
        await vi.waitFor(() => expect(stream.listenerCount("data")).toBeGreaterThan(0));

        stream.write("abc");
        stream.write("def");
        stream.end("ghi");

        await expect(resultPromise).resolves.toMatchObject({ stdout: Buffer.from("efghi") });
    });

    it("destroys an exec stream that exceeds its timeout", async () => {
        vi.useFakeTimers();
        const stream = new PassThrough();
        try {
            const resultPromise = runDockerExec(createContainer(stream), ["hang"], {
                timeoutMs: 50,
            });
            const rejection = expect(resultPromise).rejects.toThrow(
                "Docker command timed out before it completed.",
            );
            await vi.advanceTimersByTimeAsync(50);

            await rejection;
            expect(stream.destroyed).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

function createContainer(stream: PassThrough): Dockerode.Container {
    return {
        exec: async () => ({
            inspect: async () => ({ ExitCode: 0 }),
            start: async () => stream,
        }),
        modem: {
            demuxStream(source: NodeJS.ReadableStream, stdout: NodeJS.WritableStream) {
                source.pipe(stdout);
            },
        },
    } as unknown as Dockerode.Container;
}
