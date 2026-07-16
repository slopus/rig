import type { Agent, AgentContext } from "../agent/index.js";
import type { NativeProxessManager } from "../processes/index.js";
import type { Provider } from "../providers/types.js";

export interface CodingAssistantRuntime {
    agent: Agent;
    context: AgentContext;
    cwd: string;
    processManager: NativeProxessManager;
    provider: Provider;
}
