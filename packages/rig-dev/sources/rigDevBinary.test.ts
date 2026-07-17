import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binaryPath = fileURLToPath(new URL("../bin/rig-dev.js", import.meta.url));

describe("rig-dev binary", () => {
    it("runs the live Rig CLI outside the repository", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "rig-dev-binary-"));
        try {
            const { stdout } = await execFileAsync(process.execPath, [binaryPath, "--version"], {
                cwd,
            });

            expect(stdout).toMatch(/^Rig \d+\.\d+\.\d+\s*$/u);
        } finally {
            await rm(cwd, { force: true, recursive: true });
        }
    });
});
