import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getDevelopmentBuildId } from "./getDevelopmentBuildId.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("getDevelopmentBuildId", () => {
    it("is stable until a development input changes", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-development-build-"));
        temporaryDirectories.push(root);
        await mkdir(join(root, "packages/rig/sources"), { recursive: true });
        await Promise.all([
            writeFile(join(root, "package.json"), "root"),
            writeFile(join(root, "packages/rig/package.json"), "package"),
            writeFile(join(root, "pnpm-lock.yaml"), "lock"),
            writeFile(join(root, "tsconfig.base.json"), "base"),
            writeFile(join(root, "packages/rig/tsconfig.build.json"), "build"),
            writeFile(join(root, "packages/rig/tsconfig.json"), "config"),
            writeFile(join(root, "packages/rig/sources/main.ts"), "first"),
        ]);

        const first = await getDevelopmentBuildId(root);
        expect(await getDevelopmentBuildId(root)).toBe(first);

        await writeFile(join(root, "packages/rig/sources/main.ts"), "second");
        expect(await getDevelopmentBuildId(root)).not.toBe(first);
    });
});
