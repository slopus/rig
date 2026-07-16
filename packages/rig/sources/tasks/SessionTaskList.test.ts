import { describe, expect, it } from "vitest";

import { SessionTaskList } from "./SessionTaskList.js";

describe("SessionTaskList", () => {
    it("owns task creation, dependencies, deletion, and defensive copies", () => {
        const tasks = new SessionTaskList();
        const first = tasks.create({ description: "Do the first task.", subject: "First" });
        const second = tasks.create({ description: "Do the second task.", subject: "Second" });

        expect(tasks.update(first.id, { addBlocks: [second.id] })).toMatchObject({
            success: true,
            updatedFields: ["blocks"],
        });
        expect(tasks.get(first.id)?.blocks).toEqual([second.id]);
        expect(tasks.get(second.id)?.blockedBy).toEqual([first.id]);

        const listed = tasks.list();
        const listedFirst = listed[0];
        expect(listedFirst).toBeDefined();
        if (listedFirst === undefined) throw new Error("Expected the first task.");
        (listedFirst.blocks as string[]).push("external-mutation");
        expect(tasks.get(first.id)?.blocks).toEqual([second.id]);

        expect(tasks.update(first.id, { status: "deleted" })).toMatchObject({
            statusChange: { from: "pending", to: "deleted" },
            success: true,
            updatedFields: ["deleted"],
        });
        expect(tasks.get(second.id)?.blockedBy).toEqual([]);
    });

    it("restores or infers the next ID and resets it", () => {
        const tasks = new SessionTaskList(
            [
                {
                    blockedBy: [],
                    blocks: [],
                    description: "Restored task.",
                    id: "7",
                    status: "pending",
                    subject: "Restored",
                },
            ],
            undefined,
        );

        expect(tasks.nextId).toBe(8);
        expect(tasks.create({ description: "Next task.", subject: "Next" }).id).toBe("8");
        expect(tasks.reset()).toBe(true);
        expect(tasks.nextId).toBe(1);
        expect(tasks.list()).toEqual([]);
        expect(tasks.reset()).toBe(false);
    });

    it("rejects invalid dependencies without changing tasks", () => {
        const tasks = new SessionTaskList();
        const task = tasks.create({ description: "One task.", subject: "One" });

        expect(tasks.update(task.id, { addBlockedBy: [task.id] })).toEqual({
            error: "A task cannot depend on itself.",
            success: false,
            taskId: task.id,
            updatedFields: [],
        });
        expect(tasks.update(task.id, { addBlocks: ["missing"] })).toEqual({
            error: "Task missing was not found.",
            success: false,
            taskId: task.id,
            updatedFields: [],
        });
    });
});
