export type SubagentRunStatus = "aborted" | "completed" | "error" | "running";

export interface ManagedSubagent {
    description: string;
    path: string;
    sessionId: string;
    status: SubagentRunStatus;
    taskName: string;
}

export interface SpawnSubagentRequest {
    background?: boolean;
    description: string;
    parentToolCallId?: string;
    prompt: string;
    taskName?: string;
}

export interface SpawnSubagentResult {
    output: string;
    path: string;
    sessionId: string;
    status: SubagentRunStatus;
    taskName: string;
}

export interface WaitForSubagentResult {
    agents: readonly ManagedSubagent[];
    timedOut: boolean;
}

export interface SubagentContext {
    canSpawn: boolean;
    depth: number;
    followUp(target: string, message: string): ManagedSubagent;
    interrupt(target: string): ManagedSubagent;
    list(pathPrefix?: string): readonly ManagedSubagent[];
    maxDepth: number;
    spawn(request: SpawnSubagentRequest, signal?: AbortSignal): Promise<SpawnSubagentResult>;
    wait(timeoutMs?: number, signal?: AbortSignal): Promise<WaitForSubagentResult>;
}
