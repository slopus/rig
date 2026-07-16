import type {
    CreateTaskRequest,
    SessionTask,
    UpdateTaskRequest,
    UpdateTaskResult,
} from "./types.js";

export class SessionTaskList {
    #nextId: number;
    #tasks: SessionTask[];

    constructor(tasks: readonly SessionTask[] = [], nextId?: number) {
        this.#tasks = tasks.map(cloneTask);
        this.#nextId = nextId ?? inferNextTaskId(this.#tasks);
    }

    get nextId(): number {
        return this.#nextId;
    }

    create(request: CreateTaskRequest): SessionTask {
        const task: SessionTask = {
            blockedBy: [],
            blocks: [],
            description: request.description,
            id: String(this.#nextId),
            status: "pending",
            subject: request.subject,
            ...(request.activeForm !== undefined ? { activeForm: request.activeForm } : {}),
            ...(request.metadata !== undefined ? { metadata: { ...request.metadata } } : {}),
        };
        this.#nextId += 1;
        this.#tasks.push(task);
        return cloneTask(task);
    }

    get(taskId: string): SessionTask | undefined {
        const task = this.#tasks.find((candidate) => candidate.id === taskId);
        return task === undefined ? undefined : cloneTask(task);
    }

    list(): readonly SessionTask[] {
        return this.#tasks.map(cloneTask);
    }

    reset(): boolean {
        const changed = this.#tasks.length > 0;
        this.#tasks = [];
        this.#nextId = 1;
        return changed;
    }

    update(taskId: string, request: UpdateTaskRequest): UpdateTaskResult {
        const index = this.#tasks.findIndex((candidate) => candidate.id === taskId);
        const existing = this.#tasks[index];
        if (existing === undefined) {
            return { error: "Task not found", success: false, taskId, updatedFields: [] };
        }
        if (request.status === "deleted") {
            this.#tasks.splice(index, 1);
            this.#tasks = this.#tasks.map((task) => ({
                ...task,
                blockedBy: task.blockedBy.filter((dependency) => dependency !== taskId),
                blocks: task.blocks.filter((dependency) => dependency !== taskId),
            }));
            return {
                statusChange: { from: existing.status, to: "deleted" },
                success: true,
                taskId,
                updatedFields: ["deleted"],
            };
        }

        const dependencyError = this.#validateDependencies(taskId, request);
        if (dependencyError !== undefined) {
            return { error: dependencyError, success: false, taskId, updatedFields: [] };
        }

        const task = cloneTask(existing);
        const updatedFields: string[] = [];
        updateTaskString(task, "subject", request.subject, updatedFields);
        updateTaskString(task, "description", request.description, updatedFields);
        updateTaskString(task, "activeForm", request.activeForm, updatedFields);
        updateTaskString(task, "owner", request.owner, updatedFields);
        if (request.metadata !== undefined) {
            const metadata = { ...task.metadata };
            for (const [key, value] of Object.entries(request.metadata)) {
                if (value === null) delete metadata[key];
                else metadata[key] = value;
            }
            task.metadata = metadata;
            updatedFields.push("metadata");
        }
        let statusChange: UpdateTaskResult["statusChange"];
        if (request.status !== undefined && request.status !== task.status) {
            statusChange = { from: task.status, to: request.status };
            task.status = request.status;
            updatedFields.push("status");
        }
        this.#tasks[index] = task;
        this.#addDependencies(taskId, request, updatedFields);
        return {
            success: true,
            taskId,
            updatedFields,
            ...(statusChange !== undefined ? { statusChange } : {}),
        };
    }

    #addDependencies(taskId: string, request: UpdateTaskRequest, updatedFields: string[]): void {
        const task = this.#tasks.find((candidate) => candidate.id === taskId);
        if (task === undefined) return;
        for (const blockedTaskId of request.addBlocks ?? []) {
            const blockedTask = this.#tasks.find((candidate) => candidate.id === blockedTaskId);
            if (blockedTask === undefined) continue;
            if (!task.blocks.includes(blockedTaskId)) {
                task.blocks = [...task.blocks, blockedTaskId];
                pushUnique(updatedFields, "blocks");
            }
            if (!blockedTask.blockedBy.includes(taskId)) {
                blockedTask.blockedBy = [...blockedTask.blockedBy, taskId];
            }
        }
        for (const blockingTaskId of request.addBlockedBy ?? []) {
            const blockingTask = this.#tasks.find((candidate) => candidate.id === blockingTaskId);
            if (blockingTask === undefined) continue;
            if (!task.blockedBy.includes(blockingTaskId)) {
                task.blockedBy = [...task.blockedBy, blockingTaskId];
                pushUnique(updatedFields, "blockedBy");
            }
            if (!blockingTask.blocks.includes(taskId)) {
                blockingTask.blocks = [...blockingTask.blocks, taskId];
            }
        }
    }

    #validateDependencies(taskId: string, request: UpdateTaskRequest): string | undefined {
        for (const dependency of [...(request.addBlocks ?? []), ...(request.addBlockedBy ?? [])]) {
            if (dependency === taskId) return "A task cannot depend on itself.";
            if (!this.#tasks.some((task) => task.id === dependency)) {
                return `Task ${dependency} was not found.`;
            }
        }
        return undefined;
    }
}

function cloneTask(task: SessionTask): SessionTask {
    return {
        ...task,
        blockedBy: [...task.blockedBy],
        blocks: [...task.blocks],
        ...(task.metadata !== undefined ? { metadata: { ...task.metadata } } : {}),
    };
}

function inferNextTaskId(tasks: readonly SessionTask[]): number {
    return (
        tasks.reduce((highest, task) => {
            const value = Number.parseInt(task.id, 10);
            return Number.isSafeInteger(value) ? Math.max(highest, value) : highest;
        }, 0) + 1
    );
}

function updateTaskString<TKey extends "activeForm" | "description" | "owner" | "subject">(
    task: SessionTask,
    key: TKey,
    value: string | undefined,
    updatedFields: string[],
): void {
    if (value === undefined || task[key] === value) return;
    task[key] = value;
    updatedFields.push(key);
}

function pushUnique(values: string[], value: string): void {
    if (!values.includes(value)) values.push(value);
}
