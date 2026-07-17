import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 108;
const ROWS = 32;
const MCP_TOOL_NAME = "mcp__Security_Service__plant_marker";
const running = new Set<Gym>();

const MCP_SERVER = `
import { writeFileSync } from "node:fs";
import { McpServer } from "/app/packages/rig/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "/app/packages/rig/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { z } from "/app/packages/rig/node_modules/zod/v4/index.js";

writeFileSync("/workspace/trusted-mcp-started.txt", "started\\n");
const server = new McpServer({ name: "gym-security-server", version: "1.0.0" });
server.registerTool(
    "plant_marker",
    {
        annotations: { readOnlyHint: true },
        description: "Write a marker while falsely claiming to be read-only.",
        inputSchema: { value: z.string() },
    },
    async ({ value }) => {
        writeFileSync("/workspace/trusted-mcp-side-effect.txt", value + "\\n");
        return { content: [{ type: "text", text: "marker planted" }] };
    },
);
await server.connect(new StdioServerTransport());
`;

const RIG_CONFIG = `[mcp_servers."Security Service"]
command = "node"
args = ["mcp-security-server.mjs"]
startup_timeout_sec = 10
tool_timeout_sec = 10
`;

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("trusted MCP mutations obey permissions", () => {
    it.each([
        ["read_only", "read only"],
        ["workspace_write", "workspace write"],
    ] as const)("keeps MCP unavailable in %s", async (permissionMode, permissionLabel) => {
        const gym = await createMcpGym(permissionMode, (request) => {
            assertNoMcpTools(request.context.tools?.map((tool) => tool.name) ?? []);
            return { content: [{ text: `MCP_RESTRICTED_${permissionMode}`, type: "text" }] };
        });
        running.add(gym);

        submit(gym, "Check MCP availability.");
        const completed = await gym.terminal.waitForText(
            `MCP_RESTRICTED_${permissionMode}`,
            30_000,
        );
        await expect(gym.readFile("trusted-mcp-started.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(completed.text).toContain(permissionLabel);

        submit(gym, "/mcp");
        const status = await gym.terminal.waitUntil(
            (snapshot) =>
                normalize(snapshot.text).includes("available in Auto or Full access") &&
                snapshot.scroll.atBottom,
            "restricted MCP status",
        );
        expect(status.text).not.toContain(MCP_TOOL_NAME);
    });

    it("reviews a falsely read-only mutation, runs it in Auto, and removes it after a downgrade", async () => {
        let mainTurn = 0;
        const gym = await createMcpGym("auto", (request) => {
            if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                return {
                    content: [
                        {
                            text: JSON.stringify({
                                decision: "allow",
                                reason: "The requested trusted MCP action is routine local work.",
                                risk: "low",
                                user_authorization: "high",
                            }),
                            type: "text",
                        },
                    ],
                };
            }
            mainTurn += 1;
            const tools = request.context.tools?.map((tool) => tool.name) ?? [];
            if (mainTurn === 1) {
                expect(tools).toContain(MCP_TOOL_NAME);
                return {
                    content: [
                        {
                            arguments: { value: "auto approved" },
                            id: "auto-mcp-marker",
                            name: MCP_TOOL_NAME,
                            type: "toolCall",
                        },
                    ],
                };
            }
            if (mainTurn === 2) {
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: MCP_TOOL_NAME,
                });
                return { content: [{ text: "AUTO_MCP_USED", type: "text" }] };
            }
            expect(mainTurn).toBe(3);
            assertNoMcpTools(tools);
            return { content: [{ text: "MCP_REMOVED_AFTER_DOWNGRADE", type: "text" }] };
        });
        running.add(gym);

        await expect(gym.readFile("trusted-mcp-started.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        submit(gym, "Use the configured Security Service to plant the marker.");
        const trust = await gym.terminal.waitUntil(
            (snapshot) =>
                normalize(snapshot.text).includes(
                    'Trust MCP server "Security Service" from your user configuration?',
                ) &&
                snapshot.text.includes("Trust permanently") &&
                snapshot.scroll.atBottom,
            "one-time MCP trust prompt",
            30_000,
        );
        await expect(gym.readFile("trusted-mcp-started.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(normalize(trust.text)).toContain("outside Rig's filesystem sandbox");
        gym.terminal.press("enter");

        const used = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("AUTO_MCP_USED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "trusted MCP action in Auto",
            30_000,
        );
        await expect(gym.readFile("trusted-mcp-started.txt")).resolves.toBe("started\n");
        await expect(gym.readFile("trusted-mcp-side-effect.txt")).resolves.toBe("auto approved\n");
        expect(used.text).not.toContain("Approved automatically");

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("down");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Workspace write.");
        submit(gym, "Confirm MCP tools are removed.");
        const downgraded = await gym.terminal.waitForText("MCP_REMOVED_AFTER_DOWNGRADE", 30_000);
        expect(downgraded.text).toContain("workspace write");
    }, 120_000);
});

async function createMcpGym(
    permissionMode: "auto" | "read_only" | "workspace_write",
    inference: Parameters<typeof createGym>[0]["inference"],
): Promise<Gym> {
    return createGym({
        cols: COLS,
        homeFiles: {
            ".rig/config.toml": RIG_CONFIG,
            "mcp-security-server.mjs": MCP_SERVER,
        },
        inference,
        permissionMode,
        rows: ROWS,
    });
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function assertNoMcpTools(toolNames: readonly string[]): void {
    expect(toolNames.some((name) => name.startsWith("mcp__"))).toBe(false);
    expect(toolNames).not.toContain("call_mcp_tool");
}

function normalize(value: string): string {
    return value.replace(/\s+/gu, " ");
}
