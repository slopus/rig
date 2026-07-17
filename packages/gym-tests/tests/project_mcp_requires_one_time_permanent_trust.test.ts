import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const MCP_TOOL_NAME = "mcp__Project_Helper__echo_value";

const MCP_SERVER = `
import { writeFileSync } from "node:fs";
import { McpServer } from "/app/packages/rig/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "/app/packages/rig/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { z } from "/app/packages/rig/node_modules/zod/v4/index.js";

writeFileSync("/workspace/project-mcp-started.txt", "started\\n");
const server = new McpServer({ name: "project-helper", version: "1.0.0" });
server.registerTool(
    "echo_value",
    { description: "Echo a value.", inputSchema: { value: z.string() } },
    async ({ value }) => ({ content: [{ type: "text", text: value }] }),
);
await server.connect(new StdioServerTransport());
`;

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("project MCP requires one-time permanent trust", () => {
    it("does not start before consent and does not ask again on later turns", async () => {
        let mainTurns = 0;
        const gym = await createGym({
            cols: 104,
            files: {
                "project-helper.mjs": MCP_SERVER,
                "rig.toml": `[mcp_servers."Project Helper"]\ncommand = "node"\nargs = ["project-helper.mjs"]\ncwd = "/workspace"\n`,
            },
            inference(request) {
                mainTurns += 1;
                expect(request.context.tools?.map((tool) => tool.name)).toContain(MCP_TOOL_NAME);
                return {
                    content: [
                        {
                            text:
                                mainTurns === 1
                                    ? "PROJECT_MCP_TRUSTED_FIRST_TURN"
                                    : "PROJECT_MCP_TRUST_REUSED",
                            type: "text",
                        },
                    ],
                };
            },
            permissionMode: "auto",
            rows: 31,
        });
        running.add(gym);
        const startup = await gym.terminal.snapshot();
        expect(normalize(startup.text)).toContain("Project MCP needs trust");
        expect(normalize(startup.text)).toContain("need one-time trust before they start");
        await expect(gym.readFile("project-mcp-started.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });

        submit(gym, "Use the configured project helper.");
        const trust = await gym.terminal.waitUntil(
            (snapshot) =>
                normalize(snapshot.text).includes(
                    'Trust MCP server "Project Helper" from this project\'s configuration?',
                ) &&
                snapshot.text.includes("Trust permanently") &&
                snapshot.scroll.atBottom,
            "project MCP trust prompt",
            30_000,
        );
        expect(trust.text).toContain('Run "node" with arguments "project-helper.mjs"');
        await expect(gym.readFile("project-mcp-started.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        gym.terminal.press("enter");

        const first = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PROJECT_MCP_TRUSTED_FIRST_TURN") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "trusted project MCP first turn",
            30_000,
        );
        await expect(gym.readFile("project-mcp-started.txt")).resolves.toBe("started\n");
        expect(first.text).toContain("auto");

        submit(gym, "Use the same trusted project helper again.");
        const second = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PROJECT_MCP_TRUST_REUSED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "reused permanent project MCP trust",
            30_000,
        );
        expect(mainTurns).toBe(2);
        expect(second.text).toContain("PROJECT_MCP_TRUST_REUSED");
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function normalize(value: string): string {
    return value.replace(/\s+/gu, " ");
}
