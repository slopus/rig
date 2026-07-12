export type WorkflowRunStatus = "completed" | "error" | "running" | "stopped";

export interface WorkflowAgentCacheEntry {
    output: unknown;
    signature: string;
}

export interface WorkflowExecutionResult {
    agentCalls: readonly (WorkflowAgentCacheEntry | undefined)[];
    output: unknown;
}

export interface WorkflowRun {
    agentCount: number;
    description: string;
    error?: string;
    finishedAt?: number;
    logs: readonly string[];
    name: string;
    output?: unknown;
    phase?: string;
    runId: string;
    startedAt: number;
    status: WorkflowRunStatus;
    taskId: string;
}

export interface WorkflowRunUpdate {
    agentCount?: number;
    description?: string;
    error?: string;
    finishedAt?: number;
    log?: string;
    name?: string;
    output?: unknown;
    phase?: string;
    runId: string;
    startedAt?: number;
    status?: WorkflowRunStatus;
    taskId?: string;
}

export interface LaunchWorkflowRequest {
    description: string;
    execute(options: {
        onAgentCall(): void;
        onAgentResult(index: number, result: WorkflowAgentCacheEntry): void;
        onLog(message: string): void;
        resumeAgentCalls: readonly (WorkflowAgentCacheEntry | undefined)[];
        runId: string;
        signal: AbortSignal;
    }): Promise<WorkflowExecutionResult>;
    name: string;
    resumeFromRunId?: string;
}

export interface WorkflowContext {
    get(runId: string): WorkflowRun | undefined;
    launch(request: LaunchWorkflowRequest): WorkflowRun;
    stop(runId: string): WorkflowRun | undefined;
}
