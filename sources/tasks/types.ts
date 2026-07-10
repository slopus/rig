export type TaskStatus = "pending" | "in_progress" | "completed";

export interface SessionTask {
    activeForm?: string;
    blockedBy: readonly string[];
    blocks: readonly string[];
    description: string;
    id: string;
    metadata?: Readonly<Record<string, unknown>>;
    owner?: string;
    status: TaskStatus;
    subject: string;
}

export interface CreateTaskRequest {
    activeForm?: string;
    description: string;
    metadata?: Readonly<Record<string, unknown>>;
    subject: string;
}

export interface UpdateTaskRequest {
    activeForm?: string;
    addBlockedBy?: readonly string[];
    addBlocks?: readonly string[];
    description?: string;
    metadata?: Readonly<Record<string, unknown>>;
    owner?: string;
    status?: TaskStatus | "deleted";
    subject?: string;
}

export interface UpdateTaskResult {
    error?: string;
    statusChange?: { from: TaskStatus; to: TaskStatus | "deleted" };
    success: boolean;
    taskId: string;
    updatedFields: readonly string[];
}
