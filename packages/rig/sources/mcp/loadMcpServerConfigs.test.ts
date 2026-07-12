import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadMcpServerConfigEntries } from "./loadMcpServerConfigEntries.js";
import { loadMcpServerConfigs } from "./loadMcpServerConfigs.js";

describe("loadMcpServerConfigs", () => {
    it("merges Codex global and project configuration with Rig overrides", async () => {
        const root = await mkdtemp(join(tmpdir(), "rig-mcp-config-"));
        try {
            const cwd = join(root, "repo");
            const configHome = join(root, "config-home");
            await mkdir(join(configHome, "rig"), { recursive: true });
            await mkdir(join(root, "home", ".codex"), { recursive: true });
            await mkdir(join(cwd, ".codex"), { recursive: true });
            await mkdir(cwd, { recursive: true });
            await writeFile(
                join(configHome, "rig", "config.toml"),
                `
[mcp_servers.docs]
command = "docs-server"
args = ["--stdio"]
enabled_tools = ["search"]
tool_timeout_sec = 12
`,
                "utf8",
            );
            await writeFile(
                join(cwd, "rig.toml"),
                `
[mcp_servers.remote]
url = "https://example.com/mcp"
http_headers = { "X-Client" = "rig" }
oauth_client_id_env_var = "CLIENT_ID"
oauth_client_secret_env_var = "CLIENT_SECRET"
oauth_scopes = ["tools.read"]

[mcp_servers.legacy]
url = "https://example.com/sse"
transport = "sse"

[mcp_servers.docs]
command = "project-shadow"
enabled = false
`,
                "utf8",
            );
            await writeFile(
                join(root, "home", ".codex", "config.toml"),
                '[mcp_servers.docs]\ncommand = "global-docs"\n',
                "utf8",
            );
            await writeFile(
                join(cwd, ".codex", "config.toml"),
                '[mcp_servers.project]\ncommand = "project-server"\n',
                "utf8",
            );

            await expect(
                loadMcpServerConfigs(cwd, {
                    env: { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv,
                    homeDirectory: join(root, "home"),
                }),
            ).resolves.toEqual({
                docs: {
                    args: ["--stdio"],
                    command: "docs-server",
                    enabledTools: ["search"],
                    toolTimeoutMs: 12_000,
                    transport: "stdio",
                },
                project: { command: "project-server", transport: "stdio" },
                legacy: { transport: "sse", url: "https://example.com/sse" },
                remote: {
                    headers: { "X-Client": "rig" },
                    oauthClientIdEnvVar: "CLIENT_ID",
                    oauthClientSecretEnvVar: "CLIENT_SECRET",
                    oauthScopes: ["tools.read"],
                    transport: "http",
                    url: "https://example.com/mcp",
                },
            });
            const entries = await loadMcpServerConfigEntries(cwd, {
                env: { XDG_CONFIG_HOME: configHome } as NodeJS.ProcessEnv,
                homeDirectory: join(root, "home"),
            });
            expect(Object.fromEntries(entries.map((entry) => [entry.name, entry.source]))).toEqual({
                docs: "global",
                project: "project",
                legacy: "project",
                remote: "project",
            });
            expect(entries.find((entry) => entry.name === "docs")).toMatchObject({
                config: { command: "docs-server" },
                projectShadowed: true,
                source: "global",
            });
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it("does not read Claude .mcp.json project configuration", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "rig-mcp-config-"));
        try {
            await writeFile(
                join(cwd, ".mcp.json"),
                JSON.stringify({
                    mcpServers: { legacy: { type: "sse", url: "https://example.com/sse" } },
                }),
                "utf8",
            );
            await expect(
                loadMcpServerConfigs(cwd, { homeDirectory: join(cwd, "home") }),
            ).resolves.toEqual({});
        } finally {
            await rm(cwd, { force: true, recursive: true });
        }
    });
});
