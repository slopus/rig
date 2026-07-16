import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Type } from "@sinclair/typebox";

import { defineTool, type AnyDefinedTool } from "../agent/types.js";
import { humanizeMcpName } from "./humanizeMcpName.js";
import { mcpResultToContentBlocks } from "./mcpResultToContentBlocks.js";
import { isMcpErrorResult } from "./isMcpErrorResult.js";
import { normalizeMcpName } from "./normalizeMcpName.js";
import { runMcpClientCall } from "./runMcpClientCall.js";

type ListedMcpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

export function createMcpTool(options: {
    client: Client;
    serverName: string;
    tool: ListedMcpTool;
    timeoutMs?: number;
}): AnyDefinedTool {
    const qualifiedName = `mcp__${normalizeMcpName(options.serverName)}__${normalizeMcpName(options.tool.name)}`;
    const tool = defineTool({
        name: qualifiedName,
        label: qualifiedName,
        description:
            options.tool.description ?? `Use ${options.tool.name} from ${options.serverName}.`,
        // Preserve the server's JSON Schema for the provider while treating it as an
        // externally validated schema in TypeBox. Type.Unsafe uses an unregistered
        // kind that Value.Check cannot execute in the normal agent tool path.
        arguments: Type.Unknown(options.tool.inputSchema),
        returnType: Type.Unknown(),
        requiresAutoOrFullAccess: true,
        // MCP annotations are server-supplied metadata, not trusted authorization evidence.
        shouldReviewInAutoMode: () => true,
        async execute(args, context, execution) {
            const result = await runMcpClientCall(options.client, context, () =>
                options.client.callTool(
                    {
                        arguments: isRecord(args) ? args : {},
                        name: options.tool.name,
                    },
                    undefined,
                    {
                        ...(execution.signal !== undefined ? { signal: execution.signal } : {}),
                        ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
                    },
                ),
            );
            return result;
        },
        isError: isMcpErrorResult,
        toLLM: (result) => mcpResultToContentBlocks(result),
        toUI: () =>
            `${humanizeMcpName(options.serverName)} · ${humanizeMcpName(options.tool.name)}`,
        locks: [`mcp:${options.serverName}`],
    });
    return tool as AnyDefinedTool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
