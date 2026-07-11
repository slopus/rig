import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createNodeAgentContext } from "../../agent/index.js";
import { NativeProxessManager } from "../../processes/index.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { codexExecCommandTool } from "./exec_command.js";
import { codexWriteStdinTool } from "./write_stdin.js";

describe("codex write_stdin tool", () => {
    it("polls a command that outlives the initial exec yield", async () => {
        const harness = createJustBashToolHarness();
        const started = await harness.runTool(codexExecCommandTool, {
            cmd: "sleep 1; echo finished",
            yield_time_ms: 1,
        });

        expect(started.session_id).toBe(1);
        const completed = await harness.runTool(codexWriteStdinTool, {
            session_id: 1,
            yield_time_ms: 2_000,
        });

        expect(completed.output).toBe("finished\n");
        expect(completed.exit_code).toBe(0);
        expect(completed.session_id).toBeUndefined();
    });

    it("rejects unknown shell sessions", async () => {
        const harness = createJustBashToolHarness();

        await expect(
            harness.runTool(codexWriteStdinTool, { session_id: 123, yield_time_ms: 0 }),
        ).rejects.toThrow("not found");
    });

    it("sends input to a yielded native shell command", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "rig-unified-exec-test-"));
        const processManager = new NativeProxessManager();
        try {
            const context = createNodeAgentContext({ cwd, processManager });
            context.permissions?.setMode("full_access");
            const script = [
                'process.stdin.setEncoding("utf8")',
                'process.stdin.once("data", data => { process.stdout.write("received:" + data.trim()); process.exit(0) })',
            ].join(";");
            const started = await codexExecCommandTool.execute(
                {
                    cmd: `${JSON.stringify(process.execPath)} -e '${script}'`,
                    yield_time_ms: 1,
                },
                context,
                {},
            );
            expect(started.session_id).toBe(1);

            const completed = await codexWriteStdinTool.execute(
                { chars: "hello\n", session_id: 1, yield_time_ms: 2_000 },
                context,
                {},
            );
            expect(completed).toMatchObject({ exit_code: 0, output: "received:hello" });
        } finally {
            await processManager.killAll({ forceAfterMs: 100 });
            await rm(cwd, { force: true, recursive: true });
        }
    });
});
