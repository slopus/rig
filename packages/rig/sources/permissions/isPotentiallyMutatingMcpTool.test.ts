import { describe, expect, it } from "vitest";

import { isPotentiallyMutatingMcpTool } from "./isPotentiallyMutatingMcpTool.js";

describe("isPotentiallyMutatingMcpTool", () => {
    it("treats every direct and protocol MCP operation as potentially side-effecting", () => {
        for (const toolName of [
            "mcp__Deployment_Service__publish_release",
            "call_mcp_tool",
            "get_mcp_prompt",
            "list_mcp_prompts",
            "list_mcp_resources",
            "list_mcp_resource_templates",
            "list_mcp_tools",
            "read_mcp_resource",
        ]) {
            expect(isPotentiallyMutatingMcpTool(toolName), toolName).toBe(true);
        }
        expect(isPotentiallyMutatingMcpTool("read")).toBe(false);
    });
});
