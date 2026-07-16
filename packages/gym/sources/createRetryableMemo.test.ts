import { describe, expect, it, vi } from "vitest";

import { createRetryableMemo } from "./createRetryableMemo.js";

describe("createRetryableMemo", () => {
    it("retries after a failed attempt", async () => {
        const load = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("transient failure"))
            .mockResolvedValue("ready");
        const get = createRetryableMemo(load);

        await expect(get()).rejects.toThrow("transient failure");
        await expect(get()).resolves.toBe("ready");
        await expect(get()).resolves.toBe("ready");

        expect(load).toHaveBeenCalledTimes(2);
    });

    it("shares an in-flight attempt between callers", async () => {
        let resolve!: (value: string) => void;
        const load = vi.fn(
            () =>
                new Promise<string>((next) => {
                    resolve = next;
                }),
        );
        const get = createRetryableMemo(load);

        const first = get();
        const second = get();
        await Promise.resolve();
        resolve("ready");

        await expect(Promise.all([first, second])).resolves.toEqual(["ready", "ready"]);
        expect(load).toHaveBeenCalledTimes(1);
    });
});
