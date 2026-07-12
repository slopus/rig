import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { McpTrustStore } from "./McpTrustStore.js";

describe("McpTrustStore", () => {
    const directories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
        );
    });

    it("persists exact allow and deny decisions in a private user file", async () => {
        const directory = await mkdtemp(join(tmpdir(), "rig-mcp-trust-store-"));
        directories.push(directory);
        const path = join(directory, "nested", "mcp-trust.json");
        const store = new McpTrustStore(path);

        expect(await store.decision("allowed")).toBeUndefined();
        await store.remember("allowed", true);
        await store.remember("denied", false);

        const restored = new McpTrustStore(path);
        expect(await restored.decision("allowed")).toBe(true);
        expect(await restored.decision("denied")).toBe(false);
        expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    });
});
