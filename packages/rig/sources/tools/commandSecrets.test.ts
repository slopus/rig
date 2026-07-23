import { describe, expect, it } from "vitest";

import type { AgentContext, BashRunOptions, BashSessionSnapshot } from "../agent/index.js";
import { claudeBashTool } from "./claude/Bash.js";
import { codexExecCommandTool } from "../agent/tools/codex/exec_command.js";
import { grokRunTerminalCommandTool } from "./grok/run_terminal_command.js";

describe("command secret selection", () => {
    it("forwards selected secret bundle IDs through every provider shell tool", async () => {
        const { calls, context } = recordingContext();

        await codexExecCommandTool.execute(
            { cmd: "codex-command", secrets: ["service"] },
            context,
            {},
        );
        await claudeBashTool.execute(
            { command: "claude-command", secrets: ["service", "database"] },
            context,
            {},
        );
        await grokRunTerminalCommandTool.execute(
            {
                background: false,
                command: "grok-command",
                description: "Use the service",
                secrets: [],
            },
            context,
            {},
        );

        expect(calls).toHaveLength(3);
        expect(calls.map((call) => call.secrets)).toEqual([
            ["service"],
            ["service", "database"],
            [],
        ]);
    });
});

function recordingContext(): { calls: BashRunOptions[]; context: AgentContext } {
    const calls: BashRunOptions[] = [];
    const snapshots = new Map<number, BashSessionSnapshot>();
    let nextSessionId = 1;
    const context = {
        bash: {
            cwd: "/workspace",
            async killSession() {
                return undefined;
            },
            async readSession(sessionId: number) {
                return snapshots.get(sessionId);
            },
            async run(options: BashRunOptions) {
                calls.push(options);
                return { exitCode: 0, stderr: "", stdout: "", timedOut: false };
            },
            async startSession(options: Omit<BashRunOptions, "signal">) {
                calls.push(options);
                const sessionId = nextSessionId++;
                snapshots.set(sessionId, {
                    command: options.command,
                    cwd: options.cwd ?? "/workspace",
                    exitCode: 0,
                    sessionId,
                    status: "completed",
                    stderr: "",
                    stderrDelta: "",
                    stdout: "",
                    stdoutDelta: "",
                    timedOut: false,
                });
                return sessionId;
            },
            supportsSessionInput: false,
            async writeSession() {
                return false;
            },
        },
        fs: { cwd: "/workspace" },
    } as unknown as AgentContext;
    return { calls, context };
}
