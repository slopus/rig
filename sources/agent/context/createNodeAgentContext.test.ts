import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { NativeProxessManager } from "../../processes/index.js";
import { createNodeAgentContext } from "./createNodeAgentContext.js";

const tempDirs: string[] = [];

describe("createNodeAgentContext", () => {
    afterEach(async () => {
        await Promise.all(
            tempDirs.splice(0).map((path) =>
                rm(path, {
                    recursive: true,
                    force: true,
                }),
            ),
        );
    });

    it("runs bash through the explicit process manager", async () => {
        const cwd = await makeTempDir();
        const processManager = new NativeProxessManager();
        const context = createNodeAgentContext({
            cwd,
            processManager,
        });

        const result = await context.bash.run({
            command: "printf 'context-process'",
            timeoutMs: 2_000,
            maxOutputBytes: 4_096,
        });

        expect(result.stdout).toBe("context-process");
        expect(result.exitCode).toBe(0);
        expect(processManager.activeCount()).toBe(0);
    });
});

async function makeTempDir(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), "rig-context-"));
    tempDirs.push(path);
    return path;
}
