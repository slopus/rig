import type {
    AgentContext,
    AgentRunOptions,
    AgentRunResult,
    AgentSnapshot,
    ContentBlock,
} from "../agent/index.js";
import type { Model, Provider } from "../providers/types.js";

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
    reset(): void;
    send(
        content: string | readonly ContentBlock[],
        options?: AgentRunOptions,
    ): Promise<AgentRunResult>;
    setEffort(effort: string | undefined): void;
    setModel(modelId: string, effort: string | undefined, providerId?: string): void;
    snapshot(): AgentSnapshot;
}
