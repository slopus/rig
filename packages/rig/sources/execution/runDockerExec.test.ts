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

    it("streams binary stdin through an attached Docker exec", async () => {
        const stream = new PassThrough();
        const exec = vi.fn();
        const start = vi.fn();
        const input = Uint8Array.from([0, 1, 2, 255]);

        const result = await runDockerExec(createContainer(stream, { exec, start }), ["consume"], {
            stdin: input,
        });

        expect(result.stdout).toEqual(Buffer.from(input));
        expect(exec).toHaveBeenCalledWith(expect.objectContaining({ AttachStdin: true }));
        expect(start).toHaveBeenCalledWith(expect.objectContaining({ stdin: true }));
    });
});

function createContainer(
    stream: PassThrough,
    spies: { exec?: ReturnType<typeof vi.fn>; start?: ReturnType<typeof vi.fn> } = {},
): Dockerode.Container {
    const start = async (options: unknown) => {
        spies.start?.(options);
        return stream;
    };
    return {
        exec: async (options: unknown) => {
            spies.exec?.(options);
            return {
                inspect: async () => ({ ExitCode: 0 }),
                start,
            };
        },
        modem: {
            demuxStream(source: NodeJS.ReadableStream, stdout: NodeJS.WritableStream) {
                source.pipe(stdout);
            },
        },
    } as unknown as Dockerode.Container;
}
