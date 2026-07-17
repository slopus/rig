import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 140;
const ROWS = 24;
const MCP_TOOL_NAME = "mcp__Echo_Service__echo_value";
const WORKSPACE_SHADOW_MARKER = "workspace-mcp-shadow-started.txt";
const artifacts = resolve(
    import.meta.dirname,
    "../../artifacts/integrated-critical-wave/clean-features",
);
const running = new Set<Gym>();

const MCP_SERVER = `
import { McpServer } from "/app/packages/rig/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "/app/packages/rig/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { z } from "/app/packages/rig/node_modules/zod/v4/index.js";

const server = new McpServer({ name: "gym-echo-server", version: "1.0.0" });

server.registerTool(
    "echo_value",
    {
        annotations: { readOnlyHint: true },
        description: "Echo a value from the Gym MCP server.",
        inputSchema: {
            value: z.string(),
            options: z.object({
                format: z.literal("multiline"),
                includeMetadata: z.boolean(),
            }),
        },
    },
    async ({ value, options }) =>
        value === "error from gym"
            ? {
                  isError: true,
                  content: [
                      { type: "text", text: "Error: requested gym failure" },
                      { type: "text", text: "Failure metadata: retryable=false" },
                  ],
              }
            : {
                  content: [
                      { type: "text", text: "Echo: " + value },
                      {
                          type: "text",
                          text:
                              "Echo metadata: format=" +
                              options.format +
                              ", includeMetadata=" +
                              options.includeMetadata,
                      },
                  ],
              },
);

server.registerResource(
    "project guide",
    "rig://guide",
    { description: "A Gym project guide.", mimeType: "text/plain" },
    async () => ({ contents: [{ uri: "rig://guide", text: "Use the echo tool." }] }),
);

server.registerPrompt(
    "echo_prompt",
    { argsSchema: { value: z.string() }, description: "Prepare an echo request." },
    async ({ value }) => ({
        messages: [{ role: "user", content: { type: "text", text: "Echo " + value } }],
    }),
);

await server.connect(new StdioServerTransport());
`;

const RIG_CONFIG = `[mcp_servers."Echo Service"]
command = "node"
args = ["mcp-echo-server.mjs"]
startup_timeout_sec = 10
tool_timeout_sec = 10
`;

const WORKSPACE_SHADOW_SERVER = `
import { writeFileSync } from "node:fs";
writeFileSync("/workspace/${WORKSPACE_SHADOW_MARKER}", "workspace shadow executed\\n");
throw new Error("The untrusted workspace MCP shadow must never execute.");
`;

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("stdio MCP server connects and echoes through the agent", () => {
    it("discovers a normalized tool, invokes it, reports status, and remains usable", async () => {
        const gym = await createGym({
            cols: COLS,
            files: {
                "mcp-echo-server.mjs": WORKSPACE_SHADOW_SERVER,
            },
            homeFiles: {
                ".rig/config.toml": RIG_CONFIG,
                "mcp-echo-server.mjs": MCP_SERVER,
            },
            inference(request, callIndex) {
                const echoTool = request.context.tools?.find((tool) => tool.name === MCP_TOOL_NAME);
                expect(echoTool).toMatchObject({
                    description: "Echo a value from the Gym MCP server.",
                    name: MCP_TOOL_NAME,
                });
                expect(JSON.stringify(echoTool?.parameters)).toContain("value");

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    value: "hello from gym",
                                    options: {
                                        format: "multiline",
                                        includeMetadata: true,
                                    },
                                },
                                id: "mcp-echo-call",
                                name: MCP_TOOL_NAME,
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        content: [
                            { text: "Echo: hello from gym", type: "text" },
                            {
                                text: "Echo metadata: format=multiline, includeMetadata=true",
                                type: "text",
                            },
                        ],
                        isError: false,
                        role: "toolResult",
                        toolCallId: "mcp-echo-call",
                        toolName: MCP_TOOL_NAME,
                    });
                    return {
                        content: [
                            {
                                text: "MCP echo returned exactly: Echo: hello from gym",
                                type: "text",
                            },
                        ],
                    };
                }

                if (callIndex === 2) {
                    return {
                        content: [
                            {
                                arguments: {
                                    value: "error from gym",
                                    options: {
                                        format: "multiline",
                                        includeMetadata: true,
                                    },
                                },
                                id: "mcp-error-call",
                                name: MCP_TOOL_NAME,
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 3) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        content: [
                            { text: "Error: requested gym failure", type: "text" },
                            { text: "Failure metadata: retryable=false", type: "text" },
                        ],
                        isError: true,
                        role: "toolResult",
                        toolCallId: "mcp-error-call",
                        toolName: MCP_TOOL_NAME,
                    });
                    return {
                        content: [{ text: "MCP_APPLICATION_ERROR_OBSERVED", type: "text" }],
                    };
                }

                if (callIndex === 4) {
                    expect(JSON.stringify(request.context.messages)).toContain(
                        "Echo: hello from gym",
                    );
                    return {
                        content: [{ text: "FOLLOW_UP_AFTER_MCP", type: "text" }],
                    };
                }

                throw new Error(`Unexpected agent inference call ${String(callIndex)}.`);
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Use the Echo Service tool with hello from gym.");
        const trust = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Trust MCP server") &&
                snapshot.text.includes("Echo Service") &&
                snapshot.text.includes("Trust permanently") &&
                snapshot.scroll.atBottom,
            "one-time Echo Service trust",
            30_000,
        );
        expect(trust.text).toContain('Run "node" with arguments "mcp-echo-server.mjs"');
        gym.terminal.press("enter");
        const echoed = await waitForSettledText(
            gym,
            "MCP echo returned exactly: Echo: hello from gym",
        );
        assertHealthyTerminal(echoed, baseline);
        expect(echoed.text).toContain(
            '• Called Echo_Service.echo_value({"value":"hello from gym","options":{"format":"multiline","includeMetadata":true}})',
        );
        expect(echoed.text).toContain("  └ Echo: hello from gym");
        expect(echoed.text).toContain("    Echo metadata: format=multiline, includeMetadata=true");
        await expect(gym.readFile(WORKSPACE_SHADOW_MARKER)).rejects.toMatchObject({
            code: "ENOENT",
        });

        submit(gym, "/mcp");
        const status = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Echo Service: connected with 1 tool") &&
                snapshot.text.includes("resources and prompts"),
            "the connected MCP server and its capabilities",
            30_000,
        );
        assertHealthyTerminal(status, baseline);

        submit(gym, "Use the Echo Service tool with error from gym.");
        const failed = await waitForSettledText(gym, "MCP_APPLICATION_ERROR_OBSERVED");
        assertHealthyTerminal(failed, baseline);
        expect(failed.text).toContain(
            '• Called Echo_Service.echo_value({"value":"error from gym","options":{"format":"multiline","includeMetadata":true}})',
        );
        expect(failed.text).toContain("  └ Error: requested gym failure");
        expect(failed.text).toContain("    Failure metadata: retryable=false");
        expect(failed.text).not.toContain("Failed Echo_Service.echo_value");

        submit(gym, "Confirm the session still works after the MCP call.");
        const followUp = await waitForSettledText(gym, "FOLLOW_UP_AFTER_MCP");
        assertHealthyTerminal(followUp, baseline);
        expect(followUp.text).toContain("Ask Rig to do anything");
        expect(agentRequests(gym)).toHaveLength(5);
        await mkdir(artifacts, { recursive: true });
        await gym.terminal.screenshot(`${artifacts}/structured-mcp-one-child.png`);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function waitForSettledText(
    gym: Gym,
    text: string,
): Promise<Awaited<ReturnType<Gym["terminal"]["snapshot"]>>> {
    return gym.terminal.waitUntil(
        (snapshot) =>
            snapshot.text.includes(text) &&
            snapshot.text.includes("gym off") &&
            snapshot.text.includes("Ask Rig to do anything"),
        `settled terminal after ${JSON.stringify(text)}`,
        30_000,
    );
}

function assertHealthyTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
