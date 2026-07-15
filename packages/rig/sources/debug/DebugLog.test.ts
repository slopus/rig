import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DebugLog } from "./DebugLog.js";

const directories = new Set<string>();

afterEach(async () => {
    await Promise.all([...directories].map((directory) => rm(directory, { recursive: true })));
    directories.clear();
});

describe("DebugLog", () => {
    it("writes immutable, lexically ordered JSON records", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-debug-log-"));
        directories.add(root);
        const directory = join(root, ".rig", "debug", "request-1");
        let now = 1_700_000_000_000;
        const log = new DebugLog({ directory, now: () => now++ });
        const mutable = { value: "before" };

        const first = log.record("request", mutable);
        mutable.value = "after";
        const second = log.record("tool/result", { count: 2n });
        await Promise.all([first, second, log.flush()]);

        const files = (await readdir(directory)).sort();
        expect(files).toEqual(["0000000001-request.json", "0000000002-tool-result.json"]);
        await expect(readFile(join(root, ".rig", "debug", ".gitignore"), "utf8")).resolves.toBe(
            "*\n",
        );
        expect(JSON.parse(await readFile(join(directory, files[0]!), "utf8"))).toMatchObject({
            data: { value: "before" },
            sequence: 1,
            type: "request",
        });
        expect(JSON.parse(await readFile(join(directory, files[1]!), "utf8"))).toMatchObject({
            data: { count: "2n" },
            sequence: 2,
            type: "tool/result",
        });
    });

    it("serializes indirect Error cause cycles without losing error details", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-debug-log-"));
        directories.add(root);
        const directory = join(root, ".rig", "debug", "request-error");
        const log = new DebugLog({ directory });
        const error = new Error("outer failure", { cause: new Error("inner failure") });
        (error.cause as Error).cause = { outer: error };

        await log.record("run-error", { error });

        const record = JSON.parse(
            await readFile(join(directory, "0000000001-run-error.json"), "utf8"),
        );
        expect(record.data.error).toMatchObject({
            cause: {
                cause: { outer: "[Circular]" },
                message: "inner failure",
                name: "Error",
            },
            message: "outer failure",
            name: "Error",
        });
        expect(record.data.error.stack).toContain("outer failure");
    });
});
