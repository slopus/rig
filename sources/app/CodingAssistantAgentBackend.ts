import type {
    AgentContext,
    AgentRunOptions,
    AgentRunResult,
    AgentSnapshot,
} from "../agent/index.js";
import type { Model, Provider } from "../providers/types.js";

export interface CodingAssistantAgentBackend {
    readonly canChangeModel: boolean;
    readonly context: AgentContext;
    readonly id: string;
    readonly provider: Provider;
    readonly model: Model;
    reset(): void;
    send(text: string, options?: AgentRunOptions): Promise<AgentRunResult>;
    setEffort(effort: string | undefined): void;
    setModel(modelId: string, effort: string | undefined): void;
    snapshot(): AgentSnapshot;
}
