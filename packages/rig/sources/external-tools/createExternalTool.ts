import { Type } from "@sinclair/typebox";

import { defineTool, type AnyDefinedTool } from "../agent/types.js";
import { externalToolResolutionToContent } from "./externalToolResolutionToContent.js";
import type { ExternalToolCallResolution, ExternalToolDefinition } from "./types.js";

export function createExternalTool(options: {
    definition: ExternalToolDefinition;
    invoke: (
        request: {
            arguments: unknown;
            batchId: string;
            toolCallId: string;
            toolCallIndex: number;
        },
        signal?: AbortSignal,
    ) => Promise<ExternalToolCallResolution>;
}): AnyDefinedTool {
    const definition = options.definition;
    return defineTool({
        arguments: Type.Unknown(definition.parameters),
        description: definition.description,
        execution: "durable",
        label: definition.label ?? definition.name,
        name: definition.name,
        returnType: Type.Unknown(),
        requiresAutoOrFullAccess: true,
        describeAutoPermissionAction: () =>
            `call external integration function ${JSON.stringify(definition.name)} outside Rig's sandbox`,
        shouldReviewInAutoMode: () => true,
        async execute(args, _context, execution) {
            if (
                execution.toolCallId === undefined ||
                execution.toolBatchId === undefined ||
                execution.toolCallIndex === undefined
            ) {
                throw new Error("External tool execution identity is missing.");
            }
            return options.invoke(
                {
                    arguments: args,
                    batchId: execution.toolBatchId,
                    toolCallId: execution.toolCallId,
                    toolCallIndex: execution.toolCallIndex,
                },
                execution.signal,
            );
        },
        isError: (result) =>
            (result as ExternalToolCallResolution | undefined)?.status === "failed",
        toLLM: (result) => externalToolResolutionToContent(result as ExternalToolCallResolution),
        toUI: (result) =>
            (result as ExternalToolCallResolution).status === "failed"
                ? `External function ${definition.name} failed`
                : `External function ${definition.name} completed`,
        interruptionMessage: `External function ${definition.name} was interrupted.`,
        locks: [],
    }) as AnyDefinedTool;
}
