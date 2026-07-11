import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeBashTool } from "./Bash.js";
import { claudeTaskOutputTool } from "./TaskOutput.js";
import { claudeTaskStopTool } from "./TaskStop.js";

describe("Claude Code Bash tool", () => {
    it("executes commands through the agent context bash", async () => {
        const harness = createJustBashToolHarness();
        const progress: string[] = [];

        const result = await claudeBashTool.execute(
            { command: "echo claude > note.txt && cat note.txt" },
            harness.context,
            { onProgress: (display) => progress.push(display) },
        );

        expect(result.stdout).toBe("claude\n");
        expect(await harness.readFile("/workspace/note.txt")).toBe("claude\n");
        expect(progress).toContain("claude\n");
    });

    it("runs commands in the background and retrieves their output", async () => {
        const harness = createJustBashToolHarness();

        const started = await harness.runTool(claudeBashTool, {
            command: "sleep 2; echo background-complete",
            run_in_background: true,
        });
        const taskId = started.backgroundTaskId;
        expect(taskId).toBeDefined();
        expect(started.exitCode).toBeNull();

        await expect(
            harness.runTool(claudeTaskOutputTool, {
                block: false,
                task_id: taskId as string,
            }),
        ).resolves.toMatchObject({ retrieval_status: "not_ready" });

        const output = await harness.runTool(claudeTaskOutputTool, {
            block: true,
            task_id: taskId as string,
            timeout: 3_000,
        });
        expect(output).toMatchObject({
            retrieval_status: "success",
            task: {
                output: "background-complete\n",
                status: "completed",
                task_id: taskId,
                task_type: "local_bash",
            },
        });
        await expect(
            harness.runTool(claudeTaskStopTool, { task_id: taskId as string }),
        ).rejects.toThrow("not running");
    });

    it("stops a running background command", async () => {
        const harness = createJustBashToolHarness();
        const started = await harness.runTool(claudeBashTool, {
            command: "sleep 30",
            run_in_background: true,
        });
        const taskId = started.backgroundTaskId;
        expect(taskId).toBeDefined();

        await expect(
            harness.runTool(claudeTaskStopTool, { task_id: taskId as string }),
        ).resolves.toMatchObject({
            message: "The background command was stopped.",
            task_id: taskId,
        });
    });
});
