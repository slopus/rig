import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { codexExecCommandTool } from "./exec_command.js";

describe("codex exec_command tool", () => {
    it("runs a command through the agent context bash", async () => {
        const harness = createJustBashToolHarness();

        const result = await harness.runTool(codexExecCommandTool, {
            cmd: "echo codex",
        });

        expect(result.output).toBe("codex\n");
        expect(result.exit_code).toBe(0);
        expect(result.session_id).toBeUndefined();
        expect(result.wall_time_seconds).toBeGreaterThanOrEqual(0);
    });
});
