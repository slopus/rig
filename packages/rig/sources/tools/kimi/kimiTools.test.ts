import { describe, expect, it } from "vitest";

import { InMemorySessionStore } from "../../server/InMemorySessionStore.js";
import { agentTool } from "../Agent.js";
import {
    claudeBashTool,
    claudeReadTool,
    claudeSendMessageTool,
    claudeWebFetchTool,
} from "../claude/index.js";
import { createGoalTool } from "../goals/index.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import {
    kimiAgentTool,
    kimiBashTool,
    kimiCodeTools,
    kimiFetchUrlTool,
    kimiGoalTools,
    kimiReadTool,
    kimiSendMessageTool,
    kimiTaskOutputTool,
    kimiTodoListTool,
} from "./index.js";

describe("Kimi tool contracts", () => {
    it("presents Kimi-native names and guidance for Rig's supported tool surface", () => {
        expect(kimiCodeTools.map((tool) => tool.name)).toEqual([
            "TaskOutput",
            "Bash",
            "Read",
            "Edit",
            "Write",
            "Glob",
            "Grep",
            "TodoList",
            "FetchURL",
            "WebSearch",
            "TaskStop",
            "AskUserQuestion",
        ]);
        expect(kimiAgentTool.description).toContain("The subagent has its own context");
        expect(kimiSendMessageTool.name).toBe("SendMessage");
        expect(kimiReadTool.description).toContain(
            "If the user provides a concrete file path, call Read directly",
        );
        expect(kimiBashTool.description).toContain("Each call starts in a fresh shell environment");
        expect(kimiFetchUrlTool.name).toBe("FetchURL");
        expect(kimiCodeTools.map((tool) => tool.name)).not.toContain("EnterPlanMode");
        expect(kimiCodeTools.map((tool) => tool.name)).not.toContain("AgentSwarm");
    });

    it("reuses shared executions and permission policies instead of creating a Kimi security path", () => {
        expect(kimiAgentTool.execute).toBe(agentTool.execute);
        expect(kimiSendMessageTool.execute).toBe(claudeSendMessageTool.execute);
        expect(kimiBashTool.execute).toBe(claudeBashTool.execute);
        expect(kimiBashTool.shouldReviewInAutoMode).toBe(claudeBashTool.shouldReviewInAutoMode);
        expect(kimiReadTool.execute).toBe(claudeReadTool.execute);
        expect(kimiReadTool.shouldReviewInAutoMode).toBe(claudeReadTool.shouldReviewInAutoMode);
        expect(kimiFetchUrlTool.execute).toBe(claudeWebFetchTool.execute);
        expect(kimiFetchUrlTool.shouldReviewInAutoMode).toBe(
            claudeWebFetchTool.shouldReviewInAutoMode,
        );
        expect(kimiTaskOutputTool.steerable).toBe(true);
        expect(kimiGoalTools[0]?.execute).toBe(createGoalTool.execute);
    });

    it("uses Rig's real Agent schema instead of advertising unsupported Kimi arguments", () => {
        const properties = Object.keys(kimiAgentTool.arguments.properties);

        expect(properties).toEqual([
            "context",
            "description",
            "prompt",
            "effort",
            "model",
            "provider",
            "run_in_background",
        ]);
        expect(properties).not.toContain("resume");
        expect(properties).not.toContain("subagent_type");
        expect(kimiAgentTool.arguments.properties.prompt.description).toContain(
            "Complete task brief for the child",
        );
        expect(kimiAgentTool.arguments.properties.effort.description).toContain(
            "allowed effort levels",
        );
        expect(kimiReadTool.arguments.properties.file_path.description).toBe(
            "Absolute path to the file to read.",
        );
        expect(kimiBashTool.arguments.properties.dangerouslyDisableSandbox.description).toContain(
            "outside the workspace sandbox",
        );
    });

    it("persists Kimi TODO replacement and query semantics through the shared task context", async () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-kimi-todos" });
        const harness = createJustBashToolHarness();
        harness.context.tasks = {
            create: (request) => session.createTask(request),
            get: (taskId) => session.getTask(taskId),
            list: () => session.listTasks(),
            update: (taskId, request) => session.updateTask(taskId, request),
        };

        await expect(
            harness.runTool(kimiTodoListTool, {
                todos: [
                    { status: "done", title: "Audit Kimi prompts" },
                    { status: "in_progress", title: "Test delegated work" },
                ],
            }),
        ).resolves.toEqual({
            todos: [
                { status: "done", title: "Audit Kimi prompts" },
                { status: "in_progress", title: "Test delegated work" },
            ],
        });
        await expect(harness.runTool(kimiTodoListTool, {})).resolves.toEqual({
            todos: [
                { status: "done", title: "Audit Kimi prompts" },
                { status: "in_progress", title: "Test delegated work" },
            ],
        });
        expect(session.listTasks()).toMatchObject([
            { metadata: { source: "kimi_todo_list" }, status: "completed" },
            { metadata: { source: "kimi_todo_list" }, status: "in_progress" },
        ]);

        await harness.runTool(kimiTodoListTool, { todos: [] });
        expect(session.listTasks()).toEqual([]);
    });
});
