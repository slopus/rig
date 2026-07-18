import { describe, expect, it, vi } from "vitest";

import { createSandboxConfigDirectoryCache } from "./createSandboxConfigDirectoryCache.js";

describe("createSandboxConfigDirectoryCache", () => {
    it("retries after directory creation fails", async () => {
        const createDirectory = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("temporary failure"))
            .mockResolvedValueOnce("/tmp/rig-sandbox-recovered");
        const getDirectory = createSandboxConfigDirectoryCache(createDirectory);

        await expect(getDirectory()).rejects.toThrow("temporary failure");
        await expect(getDirectory()).resolves.toBe("/tmp/rig-sandbox-recovered");
        expect(createDirectory).toHaveBeenCalledTimes(2);
    });
});
