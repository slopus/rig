import { describe, expect, it } from "vitest";

import type { AnyDefinedTool } from "../agent/types.js";
import { claudeBashTool } from "../agent/tools/claude/Bash.js";
import { claudeGlobTool } from "../agent/tools/claude/Glob.js";
import { claudeGrepTool } from "../agent/tools/claude/Grep.js";
import { claudeReadTool } from "../agent/tools/claude/Read.js";
import { codexExecCommandTool } from "../agent/tools/codex/exec_command.js";
import { grokGrepTool } from "../agent/tools/grok/grep.js";
import { grokListDirTool } from "../agent/tools/grok/list_dir.js";
import { grokReadFileTool } from "../agent/tools/grok/read_file.js";
import { grokRunTerminalCommandTool } from "./grok/run_terminal_command.js";
import { createJustBashToolHarness } from "./testing/createJustBashToolHarness.js";

describe("tool call presentations", () => {
    const context = createJustBashToolHarness().context;
    const present = (tool: AnyDefinedTool, args: Record<string, unknown>) =>
        tool.toCallPresentation?.(args as never, context);

    it("defines shell exploration on each provider's shell tool", () => {
        const expected = {
            type: "exploration",
            operations: [
                { command: "rg needle src", kind: "search", path: "src", query: "needle" },
            ],
        };

        expect(present(codexExecCommandTool, { cmd: "rg needle src" })).toEqual(expected);
        expect(present(claudeBashTool, { command: "rg needle src" })).toEqual(expected);
        expect(
            present(grokRunTerminalCommandTool, {
                background: false,
                command: "rg needle src",
                description: "Search source",
            }),
        ).toEqual(expected);
    });

    it("defines native read, list, and search exploration without tool-name inference", () => {
        for (const [tool, args] of [
            [claudeReadTool, { file_path: "/workspace/src/example.ts" }],
            [grokReadFileTool, { target_file: "/workspace/src/example.ts" }],
        ] as const) {
            expect(present(tool, args)).toEqual({
                type: "exploration",
                operations: [{ kind: "read", name: "example.ts" }],
            });
        }

        for (const [tool, args] of [
            [claudeGlobTool, { path: "src", pattern: "**/*.ts" }],
        ] as const) {
            expect(present(tool, args)).toEqual({
                type: "exploration",
                operations: [{ kind: "list", target: "**/*.ts in src" }],
            });
        }
        expect(present(grokListDirTool, { target_directory: "src" })).toEqual({
            type: "exploration",
            operations: [{ kind: "list", target: "src" }],
        });

        for (const tool of [claudeGrepTool, grokGrepTool]) {
            expect(present(tool, { path: "src", pattern: "needle" })).toEqual({
                type: "exploration",
                operations: [{ command: "needle", kind: "search", path: "src", query: "needle" }],
            });
        }
    });
});
