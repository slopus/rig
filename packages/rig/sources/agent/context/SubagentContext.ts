import type { Message } from "../types.js";
import type { ServiceTier } from "@slopus/rig-execution";

export type SubagentRunStatus = "aborted" | "completed" | "error" | "running" | "suspended";
export type SubagentContextMode = "parent" | "task";

export interface AvailableSubagentModel {
    defaultEffort: string;
    effortLevels: readonly string[];
    id: string;
    name: string;
    providerId: string;
}

export interface DisabledSubagentProvider {
    id: string;
    reason: "not_authenticated" | "not_enabled" | "no_models";
}

export interface ManagedSubagent {
    description: string;
    output?: string;
    path: string;
    sessionId: string;
    status: SubagentRunStatus;
    taskName: string;
}

export interface SpawnSubagentRequest {
    background?: boolean;
    contextMode?: SubagentContextMode;
    contextMessages?: readonly Message[];
    description: string;
    effort?: string;
    encryptedPrompt?: string;
    modelId?: string;
    providerId?: string;
    serviceTier?: ServiceTier;
    parentToolCallId?: string;
    prompt: string;
    taskName?: string;
    waitForSlot?: boolean;
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
    availableModels?: readonly AvailableSubagentModel[];
    canSpawn: boolean;
    depth: number;
    disabledProviders?: readonly DisabledSubagentProvider[];
    encryptedMessages?: boolean;
    followUp(
        target: string,
        message: string,
        effort?: string,
        encryptedMessage?: string,
    ): ManagedSubagent;
    inspect?(target: string): ManagedSubagent;
    interrupt(target: string): ManagedSubagent;
    list(pathPrefix?: string): readonly ManagedSubagent[];
    maxDepth: number;
    sendMessage?(target: string, message: string, encryptedMessage?: string): ManagedSubagent;
    spawn(request: SpawnSubagentRequest, signal?: AbortSignal): Promise<SpawnSubagentResult>;
    wait(timeoutMs?: number, signal?: AbortSignal): Promise<WaitForSubagentResult>;
}
