import { describe, expect, it } from "vitest";

import {
    assembleClaudeTools,
    claudeCollaborationTools,
    claudeTools,
} from "../../tools/claude/assembleClaudeTools.js";

describe("assembleClaudeTools", () => {
    it("exposes Rig's curated native Claude tool surface from agent-owned definitions", () => {
        expect(claudeTools.map((tool) => tool.name)).toEqual([
            "TaskOutput",
            "Bash",
            "Read",
            "Edit",
            "Write",
            "Glob",
            "Grep",
            "TaskCreate",
            "TaskGet",
            "TaskUpdate",
            "TaskList",
            "WebFetch",
            "WebSearch",
            "TaskStop",
            "AskUserQuestion",
        ]);
        expect(claudeCollaborationTools.map((tool) => tool.name)).toEqual([
            "Agent",
            "Workflow",
            "WaitForWorkflow",
            "SendMessage",
        ]);
        expect(assembleClaudeTools().map((tool) => tool.name)).toEqual([
            ...claudeTools.map((tool) => tool.name),
            ...claudeCollaborationTools.map((tool) => tool.name),
        ]);
        expect(assembleClaudeTools().every((tool) => tool.description.trim().length > 0)).toBe(
            true,
        );
    });

    it("keeps important Claude-native argument constraints on the provider-facing schemas", () => {
        const tools = new Map(assembleClaudeTools().map((tool) => [tool.name, tool]));
        expect(tools.get("Bash")?.arguments).toMatchObject({
            additionalProperties: false,
            properties: {
                command: { type: "string" },
                timeout: { maximum: 600_000, minimum: 0, type: "number" },
            },
            required: ["command"],
        });
        expect(tools.get("Read")?.arguments).toMatchObject({
            additionalProperties: false,
            properties: {
                limit: { exclusiveMinimum: 0, type: "integer" },
                offset: { minimum: 0, type: "integer" },
            },
            required: ["file_path"],
        });
        expect(tools.get("AskUserQuestion")?.arguments).toMatchObject({
            additionalProperties: false,
            properties: { questions: { maxItems: 4, minItems: 1, type: "array" } },
            required: ["questions"],
        });
    });
});
