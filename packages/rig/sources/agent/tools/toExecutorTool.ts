import type { Tool as ExecutorTool } from "@slopus/rig-execution";

import type { AnyDefinedTool } from "../types.js";

export function toExecutorTool(tool: AnyDefinedTool): ExecutorTool {
    const definition =
        tool.executorTool ??
        ({
            name: tool.name,
            description: tool.description,
            parameters: tool.arguments,
        } satisfies ExecutorTool);
    if (tool.namespace === undefined || definition.kind === "tool_search") return definition;
    return {
        ...definition,
        namespace: tool.namespace.name,
        namespaceDescription: tool.namespace.description,
    };
}
