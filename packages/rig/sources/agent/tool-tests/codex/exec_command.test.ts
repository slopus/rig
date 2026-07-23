import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../../../tools/testing/createJustBashToolHarness.js";
import { codexExecCommandTool } from "../../tools/codex/exec_command.js";

describe("codex exec_command tool", () => {
    it("runs a command through the agent context bash", async () => {
        const harness = createJustBashToolHarness();
        const progress: string[] = [];

        const result = await codexExecCommandTool.execute({ cmd: "echo codex" }, harness.context, {
            onProgress: (display) => progress.push(display),
        });

        expect(result.output).toBe("codex\n");
        expect(result.exit_code).toBe(0);
        expect(result.session_id).toBeUndefined();
        expect(result.wall_time_seconds).toBeGreaterThanOrEqual(0);
        expect(progress).toContain("codex\n");
    });

    it("marks a nonzero process result as failed and summarizes its cause", async () => {
        const harness = createJustBashToolHarness();
        const result = await codexExecCommandTool.execute(
            { cmd: "printf 'permission probe blocked\\n' >&2; exit 23" },
            harness.context,
            {},
        );

        expect(result).toMatchObject({ exit_code: 23, output: "permission probe blocked\n" });
        expect(codexExecCommandTool.isError?.(result)).toBe(true);
        expect(codexExecCommandTool.toUI(result, { cmd: "ignored" })).toBe(
            "Command exited with code 23: permission probe blocked",
        );
    });

    it("makes continuing background activity explicit even when output is available", () => {
        expect(
            codexExecCommandTool.toUI(
                {
                    output: "BACKGROUND_PROCESS_STARTED\n",
                    session_id: 7,
                    wall_time_seconds: 0.25,
                },
                { cmd: "ignored" },
            ),
        ).toBe(
            "Command is still running in the background. Output so far: BACKGROUND_PROCESS_STARTED",
        );
    });
});
