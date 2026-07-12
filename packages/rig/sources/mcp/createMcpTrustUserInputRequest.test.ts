import { describe, expect, it } from "vitest";

import { createMcpTrustUserInputRequest } from "./createMcpTrustUserInputRequest.js";

describe("createMcpTrustUserInputRequest", () => {
    it("discloses the exact local command and permanence boundary", () => {
        const request = createMcpTrustUserInputRequest({
            config: {
                args: ["server.mjs", "--mode", "write"],
                command: "/usr/bin/node",
                cwd: "/Users/tester",
                env: { SERVICE_TOKEN: "not-rendered" },
                transport: "stdio",
            },
            fingerprint: "abc123",
            name: "Project helper",
            source: "project",
        });

        expect(request.requestId).toBe("mcp-trust:abc123");
        expect(request.questions[0]).toMatchObject({
            header: "MCP trust",
            id: "mcp_trust",
            options: [
                expect.objectContaining({
                    description: expect.stringContaining(
                        'Run "/usr/bin/node" with arguments "server.mjs" "--mode" "write"',
                    ),
                    label: "Trust permanently",
                }),
                expect.objectContaining({ label: "Don't trust" }),
            ],
            question: expect.stringContaining('Trust MCP server "Project helper"'),
        });
        expect(JSON.stringify(request)).toContain("SERVICE_TOKEN");
        expect(JSON.stringify(request)).not.toContain("not-rendered");
    });
});
