import { describe, expect, it } from "vitest";

import { loadHappyIntegration } from "./loadHappyIntegration.js";

describe("loadHappyIntegration", () => {
    it("keeps Happy out of embedded daemons unless explicitly enabled", async () => {
        await expect(loadHappyIntegration()).resolves.toBeUndefined();
        await expect(loadHappyIntegration("disabled")).resolves.toBeUndefined();
        await expect(loadHappyIntegration("enabled")).resolves.toMatchObject({
            HappySyncService: expect.any(Function),
            importHappyCredentials: expect.any(Function),
        });
    });
});
