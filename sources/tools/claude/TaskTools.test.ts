import { describe, expect, it } from "vitest";

import { InMemorySessionStore } from "../../server/InMemorySessionStore.js";
import { createJustBashToolHarness } from "../testing/createJustBashToolHarness.js";
import { claudeTaskCreateTool } from "./TaskCreate.js";
import { claudeTaskGetTool } from "./TaskGet.js";
import { claudeTaskListTool } from "./TaskList.js";
import { claudeTaskUpdateTool } from "./TaskUpdate.js";

describe("Claude task tools", () => {
    it("creates, links, updates, lists, and deletes persistent session tasks", async () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-task-tools" });
        const harness = createJustBashToolHarness();
        harness.context.tasks = {
            create: (request) => session.createTask(request),
            get: (taskId) => session.getTask(taskId),
            list: () => session.listTasks(),
            update: (taskId, request) => session.updateTask(taskId, request),
        };

        await harness.runTool(claudeTaskCreateTool, {
            subject: "Build the feature",
            description: "Implement the requested behavior.",
            activeForm: "Building the feature",
        });
        await harness.runTool(claudeTaskCreateTool, {
            subject: "Verify the feature",
            description: "Run the focused and full test suites.",
        });
        const linked = await harness.runTool(claudeTaskUpdateTool, {
            taskId: "2",
            addBlockedBy: ["1"],
            status: "in_progress",
        });

        expect(linked).toMatchObject({
            statusChange: { from: "pending", to: "in_progress" },
            success: true,
            updatedFields: ["status", "blockedBy"],
        });
        await expect(harness.runTool(claudeTaskListTool, {})).resolves.toEqual({
            tasks: [
                {
                    blockedBy: [],
                    id: "1",
                    status: "pending",
                    subject: "Build the feature",
                },
                {
                    blockedBy: ["1"],
                    id: "2",
                    status: "in_progress",
                    subject: "Verify the feature",
                },
            ],
        });
        await expect(harness.runTool(claudeTaskGetTool, { taskId: "1" })).resolves.toMatchObject({
            task: { blocks: ["2"], subject: "Build the feature" },
        });

        await harness.runTool(claudeTaskUpdateTool, { taskId: "1", status: "deleted" });

        expect(session.snapshot().tasks).toHaveLength(1);
        expect(session.snapshot().tasks[0]?.blockedBy).toEqual([]);
        expect(session.events.since(undefined)?.at(-1)).toMatchObject({
            data: { tasks: [expect.objectContaining({ id: "2" })] },
            type: "tasks_changed",
        });

        session.reset();

        expect(session.listTasks()).toEqual([]);
        expect(session.createTask({ subject: "Fresh task", description: "Start over." }).id).toBe(
            "1",
        );
    });

    it("rejects missing and self-referential dependencies without mutating tasks", async () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-task-tools" });
        session.createTask({ subject: "One", description: "First task." });

        expect(session.updateTask("1", { addBlockedBy: ["1"] })).toEqual({
            error: "A task cannot depend on itself.",
            success: false,
            taskId: "1",
            updatedFields: [],
        });
        expect(session.updateTask("1", { addBlocks: ["99"] })).toEqual({
            error: "Task 99 was not found.",
            success: false,
            taskId: "1",
            updatedFields: [],
        });
        expect(session.listTasks()[0]).toMatchObject({ blockedBy: [], blocks: [] });
    });
});
