import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { persistWebFetchBinary } from "./persistWebFetchBinary.js";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
        [...temporaryDirectories].map((directory) =>
            rm(directory, { force: true, recursive: true }),
        ),
    );
    temporaryDirectories.clear();
});

describe("persistWebFetchBinary", () => {
    it("stores fetched files beside the rest of Rig's durable files", async () => {
        const rigHome = await mkdtemp(join(tmpdir(), "rig-web-fetch-"));
        temporaryDirectories.add(rigHome);
        vi.stubEnv("RIG_HOME", rigHome);

        const path = await persistWebFetchBinary(Buffer.from("document"), "application/pdf");

        expect(path).toMatch(
            new RegExp(`^${escapeRegExp(join(rigHome, "tool-results"))}/webfetch-.+\\.pdf$`),
        );
        await expect(readFile(path!)).resolves.toEqual(Buffer.from("document"));
    });
});

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
