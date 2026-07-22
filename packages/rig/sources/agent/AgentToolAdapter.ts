import type { AnyDefinedTool } from "./types.js";

export interface AgentToolAdaptation {
    /** Tools exposed to the inference provider. */
    exposedTools: readonly AnyDefinedTool[];
    /** Tools callable by orchestration tools but hidden from the inference provider. */
    nestedTools: readonly AnyDefinedTool[];
}

export interface AgentToolAdapter {
    adapt(tools: readonly AnyDefinedTool[]): AgentToolAdaptation;
    close?(): Promise<void> | void;
    reset?(): Promise<void> | void;
}
