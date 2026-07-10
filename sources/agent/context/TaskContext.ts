import type {
    CreateTaskRequest,
    SessionTask,
    UpdateTaskRequest,
    UpdateTaskResult,
} from "../../tasks/index.js";

export interface TaskContext {
    create(request: CreateTaskRequest): SessionTask;
    get(taskId: string): SessionTask | undefined;
    list(): readonly SessionTask[];
    update(taskId: string, request: UpdateTaskRequest): UpdateTaskResult;
}
