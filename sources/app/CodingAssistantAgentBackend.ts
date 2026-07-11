import type {
    AgentContext,
    AgentCompactionResult,
    AgentRunOptions,
    AgentRunResult,
    AgentSnapshot,
    ContentBlock,
} from "../agent/index.js";
import type { Model, Provider } from "../providers/types.js";
import type { PermissionMode } from "../permissions/index.js";

export interface CodingAssistantModelChoice {
    model: Model;
    providerId: string;
}

export interface CodingAssistantAgentBackend {
    readonly canChangeModel: boolean;
    readonly context: AgentContext;
    readonly id: string;
    readonly provider: Provider;
    readonly model: Model;
    readonly modelChoices?: readonly CodingAssistantModelChoice[];
    readonly permissionMode: PermissionMode;
    compact(signal?: AbortSignal): Promise<AgentCompactionResult>;
    reset(): void;
    send(
        content: string | readonly ContentBlock[],
        options?: AgentRunOptions,
    ): Promise<AgentRunResult>;
    steer(content: string | readonly ContentBlock[], options?: AgentRunOptions): Promise<void>;
    setEffort(effort: string | undefined): void;
    setModel(modelId: string, effort: string | undefined, providerId?: string): void;
    setPermissionMode(mode: PermissionMode): void;
    snapshot(): AgentSnapshot;
}
