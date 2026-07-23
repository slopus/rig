import type { Agent, AgentContext } from "../agent/index.js";
import type { NativeProcessManager } from "../processes/index.js";
import type { Provider } from "@slopus/rig-execution";

export interface CodingAssistantRuntime {
    agent: Agent;
    context: AgentContext;
    cwd: string;
    processManager: NativeProcessManager;
    executor: Provider;
}
