import { describe, expect, it } from "vitest";

import { createProjectMcpSecurityNotice } from "./createProjectMcpSecurityNotice.js";

describe("createProjectMcpSecurityNotice", () => {
    it("warns for direct and shadowed project MCP configuration", () => {
        const config = { command: "server", transport: "stdio" as const };
        expect(
            createProjectMcpSecurityNotice([{ config, name: "project", source: "project" }]),
        ).toContain("need one-time trust before they start");
        expect(
            createProjectMcpSecurityNotice([
                { config, name: "trusted", projectShadowed: true, source: "global" },
            ]),
        ).toContain("user-level MCP server takes precedence");
        expect(
            createProjectMcpSecurityNotice([{ config, name: "trusted", source: "global" }]),
        ).toBeUndefined();
    });
});
