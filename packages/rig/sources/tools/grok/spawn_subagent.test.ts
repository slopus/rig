import { describe, expect, it } from "vitest";

import { grokSpawnSubagentTool } from "./spawn_subagent.js";

describe("grokSpawnSubagentTool", () => {
    it("uses the human-readable task description in the transcript", () => {
        expect(
            grokSpawnSubagentTool.toUI(
                {
                    status: "running",
                    subagent_id: "agent-1",
                    task_name: "fix_the_login_bug",
                },
                {
                    background: true,
                    description: "Fix the login bug.",
                    prompt: "Investigate and fix the login bug.",
                },
            ),
        ).toBe("Started a subagent: Fix the login bug.");
    });

    it("humanizes the generated task name when the description is blank", () => {
        expect(
            grokSpawnSubagentTool.toUI(
                {
                    status: "running",
                    subagent_id: "agent-1",
                    task_name: "delegated_task",
                },
                { description: "  ", prompt: "Handle the delegated task." },
            ),
        ).toBe("Started a subagent: Delegated task.");
    });
});
