import type {
    AgentContext,
    AgentCompactionResult,
    AgentRunOptions,
    AgentRunResult,
    AgentSnapshot,
    ContentBlock,
    UserMessage,
} from "../agent/index.js";
import type { Model, Provider, ServiceTier } from "../providers/types.js";
import type { PermissionMode } from "../permissions/index.js";
import type { GoalStatus, SessionGoal } from "../goals/index.js";
import type { AbortRunResponse } from "../protocol/index.js";

export interface CodingAssistantModelChoice {
    model: Model;
    providerId: string;
}

export interface CodingAssistantAgentBackend {
    readonly canChangeModel: boolean;
    readonly confirmedServiceTier: ServiceTier | undefined;
    readonly context: AgentContext;
    readonly id: string;
    readonly provider: Provider;
    readonly model: Model;
    readonly modelChoices?: readonly CodingAssistantModelChoice[];
    readonly permissionMode: PermissionMode;
    readonly goal?: SessionGoal | undefined;
    abort?(): Promise<AbortRunResponse>;
    compact(signal?: AbortSignal): Promise<AgentCompactionResult>;
    changeGoalStatus?(status: GoalStatus): Promise<void>;
    clearGoal?(): Promise<void>;
    reset(): void;
    rewind?(messageId: string): Promise<UserMessage>;
    send(
        content: string | readonly ContentBlock[],
        options?: AgentRunOptions,
    ): Promise<AgentRunResult>;
    steer(content: string | readonly ContentBlock[], options?: AgentRunOptions): Promise<void>;
    setEffort(effort: string | undefined): void;
    setModel(
        modelId: string,
        effort: string | undefined,
        providerId?: string,
    ): void | Promise<void>;
    setServiceTier(serviceTier: ServiceTier | undefined): void | Promise<void>;
    setPermissionMode(mode: PermissionMode): void | Promise<void>;
    setGoal?(objective: string): Promise<void>;
    snapshot(): AgentSnapshot;
}
