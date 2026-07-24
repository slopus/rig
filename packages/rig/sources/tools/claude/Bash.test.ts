import { describe, expect, it } from "vitest";

import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeBashTool } from "../../agent/tools/claude/Bash.js";
import { claudeTaskOutputTool } from "../../agent/tools/claude/TaskOutput.js";
import { claudeTaskStopTool } from "../../agent/tools/claude/TaskStop.js";

describe("Claude Code Bash tool", () => {
    it("allows steering to interrupt passive task-output waits", () => {
        expect(claudeTaskOutputTool.steerable).toBe(true);
    });

    it("executes commands through the agent context bash", async () => {
        const harness = createJustBashToolHarness();
        const progress: string[] = [];
        const startSession = harness.context.bash.startSession.bind(harness.context.bash);
        let observedTimeout: number | undefined;
        let observedMaxOutputBytes: number | undefined;
        harness.context.bash.startSession = (options) => {
            observedTimeout = options.timeoutMs;
            observedMaxOutputBytes = options.maxOutputBytes;
            return startSession(options);
        };

        const result = await claudeBashTool.execute(
            { command: "echo claude > note.txt && cat note.txt" },
            harness.context,
            { onProgress: (display) => progress.push(display) },
        );

        expect(result.stdout).toBe("claude\n");
        expect(await harness.readFile("/workspace/note.txt")).toBe("claude\n");
        expect(progress).toContain("claude\n");
        expect(observedTimeout).toBe(120_000);
        expect(observedMaxOutputBytes).toBe(512_000);
    });

    it("returns only a 50KB tail to Claude for large foreground output", async () => {
        const harness = createJustBashToolHarness();
        harness.context.bash.run = async () => ({
            exitCode: 0,
            stderr: "",
            stdout: `old-head-${"x".repeat(60_000)}-new-tail`,
            timedOut: false,
        });

        const result = await claudeBashTool.execute(
            { command: "produce a large grep line" },
            harness.context,
            {},
        );
        const rendered = claudeBashTool.toLLM(result);
        const text = rendered[0]?.type === "text" ? rendered[0].text : "";

        expect(Buffer.byteLength(text, "utf8")).toBeLessThan(52_000);
        expect(text).not.toContain("old-head");
        expect(text).toContain("new-tail");
        expect(text).toContain("Earlier output was truncated");
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

    it("bounds large background command output before returning it to Claude", async () => {
        const harness = createJustBashToolHarness();
        const started = await harness.runTool(claudeBashTool, {
            command: "printf 'old-head-'; printf '%060000d' 0; printf '%s' '-new-tail'",
            run_in_background: true,
        });

        const output = await harness.runTool(claudeTaskOutputTool, {
            block: true,
            task_id: started.backgroundTaskId as string,
            timeout: 3_000,
        });
        const taskOutput = output.task?.task_type === "local_bash" ? output.task.output : "";

        expect(Buffer.byteLength(taskOutput, "utf8")).toBeLessThan(52_000);
        expect(taskOutput).not.toContain("old-head");
        expect(taskOutput).toContain("new-tail");
        expect(taskOutput).toContain("Earlier output was truncated");
    });

    it("does not impose a foreground timeout on background commands", async () => {
        const harness = createJustBashToolHarness();
        const startSession = harness.context.bash.startSession.bind(harness.context.bash);
        let observedTimeout: number | undefined;
        harness.context.bash.startSession = (options) => {
            observedTimeout = options.timeoutMs;
            return startSession(options);
        };

        const started = await harness.runTool(claudeBashTool, {
            command: "sleep 30",
            run_in_background: true,
        });

        await harness.runTool(claudeTaskStopTool, {
            task_id: started.backgroundTaskId as string,
        });
        expect(observedTimeout).toBeUndefined();
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
