import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ClientCredentialsProvider } from "@modelcontextprotocol/sdk/client/auth-extensions.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ElicitRequestSchema, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { createShellEnvironment } from "../agent/context/createShellEnvironment.js";
import { errorToMessage } from "../errorToMessage.js";
import { readPackageVersion } from "../readPackageVersion.js";
import { handleMcpElicitation } from "./handleMcpElicitation.js";
import type { McpServerConfig } from "./types.js";

export interface ConnectedMcpServer {
    client: Client;
    close(): Promise<void>;
}

export async function connectMcpServer(
    name: string,
    config: McpServerConfig,
    workspaceCwd: string,
    trustedServerCwd: string,
    env: NodeJS.ProcessEnv = process.env,
): Promise<ConnectedMcpServer> {
    const client = new Client(
        { name: "rig", version: readPackageVersion() },
        { capabilities: { elicitation: { form: {} }, roots: { listChanged: false } } },
    );
    client.setRequestHandler(ElicitRequestSchema, (request) =>
        handleMcpElicitation(client, request),
    );
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: pathToFileURL(workspaceCwd).href, name: "Workspace" }],
    }));
    const transport = createTransport(config, trustedServerCwd, env);
    try {
        await client.connect(transport, { timeout: config.startupTimeoutMs ?? 10_000 });
    } catch (error) {
        await transport.close().catch(() => undefined);
        throw new Error(`MCP server "${name}" could not connect: ${errorToMessage(error)}`);
    }
    return {
        client,
        close: () => client.close(),
    };
}

function createTransport(
    config: McpServerConfig,
    trustedServerCwd: string,
    env: NodeJS.ProcessEnv,
): Transport {
    if (config.transport === "stdio") {
        return new StdioClientTransport({
            args: [...(config.args ?? [])],
            command: config.command,
            cwd:
                config.cwd === undefined ? trustedServerCwd : resolve(trustedServerCwd, config.cwd),
            env: {
                ...stringEnvironment(createShellEnvironment(env)),
                ...config.env,
            },
            stderr: "ignore",
        });
    }

    const headers = new Headers(config.headers);
    if (config.bearerTokenEnvVar !== undefined) {
        const token = env[config.bearerTokenEnvVar];
        if (token === undefined || token === "") {
            throw new Error(
                `MCP bearer token environment variable "${config.bearerTokenEnvVar}" is not set.`,
            );
        }
        headers.set("Authorization", `Bearer ${token}`);
    }
    const oauthProvider = createOAuthProvider(config, env);
    return new StreamableHTTPClientTransport(new URL(config.url), {
        ...(oauthProvider === undefined ? {} : { authProvider: oauthProvider }),
        requestInit: { headers },
    }) as unknown as Transport;
}

function createOAuthProvider(
    config: Extract<McpServerConfig, { url: string }>,
    env: NodeJS.ProcessEnv,
): ClientCredentialsProvider | undefined {
    const idVariable = config.oauthClientIdEnvVar;
    const secretVariable = config.oauthClientSecretEnvVar;
    if (idVariable === undefined && secretVariable === undefined) return undefined;
    if (idVariable === undefined || secretVariable === undefined) {
        throw new Error(
            "MCP OAuth requires both oauth_client_id_env_var and oauth_client_secret_env_var.",
        );
    }
    const clientId = env[idVariable];
    const clientSecret = env[secretVariable];
    if (
        clientId === undefined ||
        clientId === "" ||
        clientSecret === undefined ||
        clientSecret === ""
    ) {
        throw new Error("MCP OAuth client credential environment variables are not set.");
    }
    return new ClientCredentialsProvider({
        clientId,
        clientSecret,
        ...(config.oauthScopes === undefined ? {} : { scope: config.oauthScopes.join(" ") }),
    });
}

function stringEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
    return Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
}
