import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Type } from "@sinclair/typebox";

import { defineTool, type AnyDefinedTool, type ContentBlock } from "../agent/types.js";
import { boundedJsonStringify } from "../app/boundedJsonStringify.js";
import { describeMcpAutoPermissionAction } from "./describeMcpAutoPermissionAction.js";
import { runMcpClientCall } from "./runMcpClientCall.js";
import { mcpResultToContentBlocks } from "./mcpResultToContentBlocks.js";
import { MCP_RESULT_MAXIMUM_TEXT_BYTES } from "./mcpResultMaximumTextBytes.js";
import { isMcpErrorResult } from "./isMcpErrorResult.js";

const MAXIMUM_RESOURCE_CONTENTS = 128;
const MAXIMUM_UNKNOWN_RESOURCE_BYTES = 4_096;

interface McpProtocolConnection {
    client: Client;
    disabledTools?: readonly string[];
    enabledTools?: readonly string[];
    name: string;
    timeoutMs?: number;
}

export function createMcpProtocolTools(
    connections: readonly McpProtocolConnection[],
): readonly AnyDefinedTool[] {
    const byName = new Map(connections.map((connection) => [connection.name, connection]));
    const serverNames = [...byName.keys()].sort().join(", ");
    const connection = (server: string): McpProtocolConnection => {
        const selected = byName.get(server);
        if (selected === undefined) {
            throw new Error(`Unknown MCP server "${server}". Available servers: ${serverNames}.`);
        }
        return selected;
    };
    const requestOptions = (selected: McpProtocolConnection) =>
        selected.timeoutMs === undefined ? undefined : { timeout: selected.timeoutMs };
    const toolAllowed = (selected: McpProtocolConnection, name: string) =>
        (selected.enabledTools === undefined || selected.enabledTools.includes(name)) &&
        !selected.disabledTools?.includes(name);
    const jsonBlocks = (value: unknown): readonly ContentBlock[] => [
        { type: "text", text: boundedJsonStringify(value, MCP_RESULT_MAXIMUM_TEXT_BYTES) },
    ];

    return [
        defineTool({
            name: "list_mcp_tools",
            label: "List MCP tools",
            description: `Lists the current live tool catalog from an MCP server, including tools added after the session started. Available servers: ${serverNames}.`,
            arguments: Type.Object({
                server: Type.String(),
                cursor: Type.Optional(Type.String()),
            }),
            returnType: Type.Unknown(),
            requiresAutoOrFullAccess: true,
            shouldReviewInAutoMode: () => false,
            async execute({ server, cursor }, context) {
                const selected = connection(server);
                const result = await runMcpClientCall(selected.client, context, () =>
                    selected.client.listTools(
                        cursor === undefined ? undefined : { cursor },
                        requestOptions(selected),
                    ),
                );
                return {
                    ...result,
                    tools: result.tools.filter((tool) => toolAllowed(selected, tool.name)),
                };
            },
            toLLM: jsonBlocks,
            toUI: (_result, args) => `Listed live tools from ${humanize(args.server)}`,
            locks: [],
        }),
        defineTool({
            name: "call_mcp_tool",
            label: "Call MCP tool",
            description: `Calls a tool from an MCP server by its live server-side name. Use list_mcp_tools for tools added after session startup. Available servers: ${serverNames}.`,
            arguments: Type.Object({
                server: Type.String(),
                name: Type.String(),
                arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
            }),
            returnType: Type.Unknown(),
            requiresAutoOrFullAccess: true,
            describeAutoPermissionAction: ({ server, name, arguments: toolArguments }) =>
                describeMcpAutoPermissionAction({
                    arguments: toolArguments ?? {},
                    server,
                    tool: name,
                }),
            shouldReviewInAutoMode: () => true,
            async execute({ server, name, arguments: toolArguments }, context, execution) {
                const selected = connection(server);
                if (!toolAllowed(selected, name)) {
                    throw new Error(
                        `The MCP tool "${humanize(name)}" is disabled by the server policy.`,
                    );
                }
                return runMcpClientCall(selected.client, context, () =>
                    selected.client.callTool({ name, arguments: toolArguments ?? {} }, undefined, {
                        ...(execution.signal === undefined ? {} : { signal: execution.signal }),
                        ...(selected.timeoutMs === undefined
                            ? {}
                            : { timeout: selected.timeoutMs }),
                    }),
                );
            },
            isError: isMcpErrorResult,
            toLLM: mcpResultToContentBlocks,
            toUI: (_result, args) => `Called ${humanize(args.name)} from ${humanize(args.server)}`,
            locks: [(args) => `mcp:${args.server}`],
        }),
        defineTool({
            name: "list_mcp_resources",
            label: "List MCP resources",
            description: `Lists resources exposed by an MCP server. Available servers: ${serverNames}. Use the returned nextCursor to continue pagination.`,
            arguments: Type.Object({
                server: Type.String(),
                cursor: Type.Optional(Type.String()),
            }),
            returnType: Type.Unknown(),
            requiresAutoOrFullAccess: true,
            shouldReviewInAutoMode: () => false,
            async execute({ server, cursor }, context) {
                const selected = connection(server);
                return runMcpClientCall(selected.client, context, () =>
                    selected.client.listResources(
                        cursor === undefined ? undefined : { cursor },
                        requestOptions(selected),
                    ),
                );
            },
            toLLM: jsonBlocks,
            toUI: (_result, args) => `Listed resources from ${humanize(args.server)}`,
            locks: [],
        }),
        defineTool({
            name: "list_mcp_resource_templates",
            label: "List MCP resource templates",
            description: `Lists parameterized resource templates exposed by an MCP server. Available servers: ${serverNames}. Use the returned nextCursor to continue pagination.`,
            arguments: Type.Object({
                server: Type.String(),
                cursor: Type.Optional(Type.String()),
            }),
            returnType: Type.Unknown(),
            requiresAutoOrFullAccess: true,
            shouldReviewInAutoMode: () => false,
            async execute({ server, cursor }, context) {
                const selected = connection(server);
                return runMcpClientCall(selected.client, context, () =>
                    selected.client.listResourceTemplates(
                        cursor === undefined ? undefined : { cursor },
                        requestOptions(selected),
                    ),
                );
            },
            toLLM: jsonBlocks,
            toUI: (_result, args) => `Listed resource templates from ${humanize(args.server)}`,
            locks: [],
        }),
        defineTool({
            name: "read_mcp_resource",
            label: "Read MCP resource",
            description: `Reads a resource from an MCP server. Available servers: ${serverNames}. Use a URI returned by list_mcp_resources or constructed from a listed resource template.`,
            arguments: Type.Object({ server: Type.String(), uri: Type.String() }),
            returnType: Type.Unknown(),
            requiresAutoOrFullAccess: true,
            shouldReviewInAutoMode: () => false,
            async execute({ server, uri }, context) {
                const selected = connection(server);
                return runMcpClientCall(selected.client, context, () =>
                    selected.client.readResource({ uri }, requestOptions(selected)),
                );
            },
            toLLM(result) {
                if (
                    result !== null &&
                    typeof result === "object" &&
                    "contents" in result &&
                    Array.isArray(result.contents)
                ) {
                    const contentBlocks = result.contents
                        .slice(0, MAXIMUM_RESOURCE_CONTENTS)
                        .map((content): Record<string, unknown> | undefined => {
                            if (content === null || typeof content !== "object") return undefined;
                            if ("text" in content && typeof content.text === "string") {
                                return { type: "text", text: content.text };
                            }
                            if (
                                "blob" in content &&
                                typeof content.blob === "string" &&
                                "mimeType" in content &&
                                typeof content.mimeType === "string" &&
                                content.mimeType.startsWith("image/")
                            ) {
                                return {
                                    type: "image",
                                    data: content.blob,
                                    mimeType: content.mimeType,
                                };
                            }
                            return {
                                type: "text",
                                text: boundedJsonStringify(content, MAXIMUM_UNKNOWN_RESOURCE_BYTES),
                            };
                        })
                        .filter(
                            (content): content is Record<string, unknown> => content !== undefined,
                        );
                    if (result.contents.length > MAXIMUM_RESOURCE_CONTENTS) {
                        contentBlocks.push({ type: "text", text: "... [truncated]" });
                    }
                    const blocks = mcpResultToContentBlocks({ content: contentBlocks });
                    if (blocks.length > 0) return blocks;
                }
                return jsonBlocks(result);
            },
            toUI: (_result, args) => `Read a resource from ${humanize(args.server)}`,
            locks: [],
        }),
        defineTool({
            name: "list_mcp_prompts",
            label: "List MCP prompts",
            description: `Lists reusable prompts exposed by an MCP server. Available servers: ${serverNames}. Use the returned nextCursor to continue pagination.`,
            arguments: Type.Object({
                server: Type.String(),
                cursor: Type.Optional(Type.String()),
            }),
            returnType: Type.Unknown(),
            requiresAutoOrFullAccess: true,
            shouldReviewInAutoMode: () => false,
            async execute({ server, cursor }, context) {
                const selected = connection(server);
                return runMcpClientCall(selected.client, context, () =>
                    selected.client.listPrompts(
                        cursor === undefined ? undefined : { cursor },
                        requestOptions(selected),
                    ),
                );
            },
            toLLM: jsonBlocks,
            toUI: (_result, args) => `Listed prompts from ${humanize(args.server)}`,
            locks: [],
        }),
        defineTool({
            name: "get_mcp_prompt",
            label: "Get MCP prompt",
            description: `Gets a reusable prompt from an MCP server. Available servers: ${serverNames}.`,
            arguments: Type.Object({
                server: Type.String(),
                name: Type.String(),
                arguments: Type.Optional(Type.Record(Type.String(), Type.String())),
            }),
            returnType: Type.Unknown(),
            requiresAutoOrFullAccess: true,
            describeAutoPermissionAction: ({ server, name }) =>
                `loading prompt "${humanize(name)}" from "${humanize(server)}". Access: the MCP server can return instructions from outside Rig’s local sandbox`,
            shouldReviewInAutoMode: () => true,
            async execute({ server, name, arguments: promptArguments }, context) {
                const selected = connection(server);
                return runMcpClientCall(selected.client, context, () =>
                    selected.client.getPrompt(
                        {
                            name,
                            ...(promptArguments === undefined
                                ? {}
                                : { arguments: promptArguments }),
                        },
                        requestOptions(selected),
                    ),
                );
            },
            toLLM: jsonBlocks,
            toUI: (_result, args) => `Loaded ${humanize(args.name)} from ${humanize(args.server)}`,
            locks: [],
        }),
    ] as readonly AnyDefinedTool[];
}

function humanize(value: string): string {
    return value
        .replace(/[_-]+/gu, " ")
        .replace(/([a-z])([A-Z])/gu, "$1 $2")
        .replace(/\s+/gu, " ")
        .trim();
}
