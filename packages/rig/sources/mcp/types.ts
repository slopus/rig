import type { AnyDefinedTool } from "../agent/index.js";
import type { PermissionMode } from "../permissions/index.js";

export interface McpServerConfigBase {
    disabledTools?: readonly string[];
    enabled?: boolean;
    enabledTools?: readonly string[];
    startupTimeoutMs?: number;
    toolTimeoutMs?: number;
}

export interface McpStdioServerConfig extends McpServerConfigBase {
    args?: readonly string[];
    command: string;
    cwd?: string;
    env?: Readonly<Record<string, string>>;
    transport: "stdio";
}

export interface McpHttpServerConfig extends McpServerConfigBase {
    bearerTokenEnvVar?: string;
    headers?: Readonly<Record<string, string>>;
    oauthClientIdEnvVar?: string;
    oauthClientSecretEnvVar?: string;
    oauthScopes?: readonly string[];
    transport: "http" | "sse";
    url: string;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export type McpServerConfigSource = "global" | "project" | "runtime";

export interface McpServerConfigEntry {
    config: McpServerConfig;
    name: string;
    projectShadowed?: boolean;
    source: McpServerConfigSource;
}

export interface McpServerTrustRequest {
    config: McpServerConfig;
    effectiveCwd?: string;
    fingerprint: string;
    name: string;
    source: McpServerConfigSource;
}

export interface McpToolLoadOptions {
    requestTrust?: (request: McpServerTrustRequest) => Promise<boolean>;
}

export interface McpServerSummary {
    errorMessage?: string;
    name: string;
    status: "blocked" | "connected" | "disabled" | "failed";
    promptSupport?: boolean;
    resourceSupport?: boolean;
    toolCount: number;
}

export interface McpToolLoadResult {
    servers: readonly McpServerSummary[];
    tools: readonly AnyDefinedTool[];
}

export interface McpToolProvider {
    close(): Promise<void>;
    load(
        cwd: string,
        permissionMode: PermissionMode,
        options?: McpToolLoadOptions,
    ): Promise<McpToolLoadResult>;
}
