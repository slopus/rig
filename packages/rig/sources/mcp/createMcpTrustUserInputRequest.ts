import type { McpServerTrustRequest } from "./types.js";
import type { UserInputRequest } from "../user-input/index.js";

export const MCP_TRUST_ANSWER = "Trust permanently";

export function createMcpTrustUserInputRequest(request: McpServerTrustRequest): UserInputRequest {
    const source =
        request.source === "project"
            ? "this project's configuration"
            : request.source === "runtime"
              ? "your saved Rig preferences"
              : "your user configuration";
    const boundary =
        request.config.transport === "stdio"
            ? `Run ${quote(request.config.command)}${
                  request.config.args?.length
                      ? ` with arguments ${request.config.args.map(quote).join(" ")}`
                      : ""
              } from ${quote(request.effectiveCwd ?? request.config.cwd ?? "the user home directory")}.`
            : `Connect to ${quote(request.config.url)}.`;
    const environment =
        request.config.transport === "stdio" && request.config.env !== undefined
            ? ` It receives configured environment values for ${Object.keys(request.config.env)
                  .sort()
                  .join(", ")}.`
            : "";

    return {
        requestId: `mcp-trust:${request.fingerprint}`,
        questions: [
            {
                header: "MCP trust",
                id: "mcp_trust",
                multiSelect: false,
                options: [
                    {
                        description: `${boundary}${environment} This decision is saved and Rig asks again if the server configuration changes.`,
                        label: MCP_TRUST_ANSWER,
                    },
                    {
                        description:
                            "Do not start or connect to this server, and remember that decision on this machine.",
                        label: "Don't trust",
                    },
                ],
                question: `Trust MCP server ${quote(request.name)} from ${source}? MCP servers operate outside Rig's filesystem sandbox.`,
            },
        ],
    };
}

function quote(value: string): string {
    return JSON.stringify(value);
}
