import { Value } from "@sinclair/typebox/value";

import { errorToMessage } from "../errorToMessage.js";
import type { AgentContext } from "./context/AgentContext.js";
import { createErrorToolResultBlock } from "./createErrorToolResultBlock.js";
import { createToolResultBlock } from "./createToolResultBlock.js";
import type { AnyDefinedTool, Message, ToolResultBlock } from "./types.js";

export async function executePreapprovedToolCall(options: {
    batchId: string;
    context: AgentContext;
    messages: readonly Message[];
    onBeforeExecute?: () => void;
    signal?: AbortSignal;
    toolCall: { arguments: unknown; id: string; index: number; name: string };
    tools: readonly AnyDefinedTool[];
}): Promise<ToolResultBlock> {
    const tool = options.tools.find((candidate) => candidate.name === options.toolCall.name);
    if (tool === undefined) {
        return createErrorToolResultBlock(
            options.toolCall,
            `Unknown tool '${options.toolCall.name}' requested by model`,
            { kind: "tool_unavailable" },
        );
    }
    if (!Value.Check(tool.arguments, options.toolCall.arguments)) {
        return createErrorToolResultBlock(
            options.toolCall,
            `Invalid arguments for tool '${tool.name}'`,
            { kind: "invalid_arguments" },
        );
    }
    if (options.context.permissions === undefined) {
        return createErrorToolResultBlock(
            options.toolCall,
            "This action requires an available permission context.",
        );
    }
    if (
        tool.requiresAutoOrFullAccess &&
        options.context.permissions.mode !== "auto" &&
        options.context.permissions.mode !== "full_access"
    ) {
        return createErrorToolResultBlock(
            options.toolCall,
            "This action requires Auto or Full access because it can operate outside Rig's local sandbox.",
        );
    }

    try {
        const execution = {
            messages: options.messages,
            toolBatchId: options.batchId,
            toolCallId: options.toolCall.id,
            toolCallIndex: options.toolCall.index,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        };
        const run = () =>
            tool.execute(options.toolCall.arguments as never, options.context, execution);
        const runWithFullAccess =
            options.context.permissions.mode === "auto" &&
            (await tool.shouldRunInFullAccessInAutoMode(
                options.toolCall.arguments as never,
                options.context,
            ));
        options.onBeforeExecute?.();
        const result = runWithFullAccess
            ? await options.context.permissions.runWithMode("full_access", run)
            : await run();
        return createToolResultBlock(tool, options.toolCall.arguments, result, options.toolCall.id);
    } catch (error) {
        const message = errorToMessage(error);
        return createErrorToolResultBlock(
            options.toolCall,
            `Tool '${tool.name}' failed: ${message}`,
            { kind: "execution_failed", message },
        );
    }
}
