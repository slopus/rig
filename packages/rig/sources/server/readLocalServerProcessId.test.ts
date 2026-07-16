import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readLocalServerProcessId } from "./readLocalServerProcessId.js";

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("readLocalServerProcessId", () => {
    it("reads a positive integer process ID", async () => {
        const path = await registryPath();
        await writeFile(path, JSON.stringify({ pid: 42 }), "utf8");

        await expect(readLocalServerProcessId(path)).resolves.toBe(42);
    });

    it("rejects missing and malformed process IDs", async () => {
        const path = await registryPath();
        await writeFile(path, JSON.stringify({ pid: "42" }), "utf8");

        await expect(readLocalServerProcessId(path)).resolves.toBeUndefined();
        await expect(readLocalServerProcessId(`${path}.missing`)).resolves.toBeUndefined();
    });
});

async function registryPath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "rig-server-registry-"));
    directories.push(directory);
    return join(directory, "server.json");
}
