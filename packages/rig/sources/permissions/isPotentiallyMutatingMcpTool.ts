const MCP_PROTOCOL_TOOLS = new Set([
    "call_mcp_tool",
    "get_mcp_prompt",
    "list_mcp_prompts",
    "list_mcp_resources",
    "list_mcp_resource_templates",
    "list_mcp_tools",
    "read_mcp_resource",
]);

export function isPotentiallyMutatingMcpTool(toolName: string): boolean {
    return MCP_PROTOCOL_TOOLS.has(toolName) || toolName.startsWith("mcp__");
}
