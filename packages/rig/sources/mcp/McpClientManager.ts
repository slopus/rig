import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { errorToMessage } from "../errorToMessage.js";
import { connectMcpServer, type ConnectedMcpServer } from "./connectMcpServer.js";
import { createMcpProtocolTools } from "./createMcpProtocolTools.js";
import { createMcpTool } from "./createMcpTool.js";
import { fingerprintMcpServer } from "./fingerprintMcpServer.js";
import { getDefaultMcpTrustPath } from "./getDefaultMcpTrustPath.js";
import { loadMcpServerConfigEntries } from "./loadMcpServerConfigEntries.js";
import { McpTrustStore } from "./McpTrustStore.js";
import type {
    McpServerConfig,
    McpServerConfigEntry,
    McpServerSummary,
    McpToolLoadResult,
    McpToolLoadOptions,
    McpToolProvider,
} from "./types.js";
import type { PermissionMode } from "../permissions/index.js";

const RESTRICTED_MCP_BLOCKED_REASON =
    "MCP servers are available in Auto or Full access because they can act outside Rig's sandbox.";
const MCP_TRUST_REQUIRED_REASON = "This MCP server needs one-time trust approval before it starts.";
const MCP_NOT_TRUSTED_REASON = "This MCP server is not trusted on this machine.";
const PROJECT_SHADOWED_REASON =
    "A trusted user-level server with this name takes precedence over the project configuration.";

interface LoadedConnectionSet extends McpToolLoadResult {
    cacheable: boolean;
    connections: readonly ConnectedMcpServer[];
}

interface ConnectedServerResult {
    config: McpServerConfig;
    connection: ConnectedMcpServer;
    name: string;
    tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
}

interface FailedServerResult {
    errorMessage: string;
    name: string;
}

type ServerResult = ConnectedServerResult | FailedServerResult;

export interface McpClientManagerOptions {
    env?: NodeJS.ProcessEnv;
    homeDirectory?: string;
    trustStore?: McpTrustStore;
}

export class McpClientManager implements McpToolProvider {
    #allConnectionSets = new Set<Promise<LoadedConnectionSet>>();
    #closingConnectionSets = new Map<Promise<LoadedConnectionSet>, Promise<void>>();
    #connectionReferences = new Map<Promise<LoadedConnectionSet>, number>();
    #connectionSets = new Map<string, Promise<LoadedConnectionSet>>();
    #connectionKeysByCwd = new Map<string, string>();
    #env: NodeJS.ProcessEnv;
    #homeDirectory: string | undefined;
    #retiredConnectionSets = new Set<Promise<LoadedConnectionSet>>();
    #trustStore: McpTrustStore;

    constructor(options: McpClientManagerOptions = {}) {
        this.#env = options.env ?? process.env;
        this.#homeDirectory = options.homeDirectory;
        this.#trustStore =
            options.trustStore ??
            new McpTrustStore(
                getDefaultMcpTrustPath(this.#env, options.homeDirectory ?? homedir()),
            );
    }

    async load(
        cwd: string,
        permissionMode: PermissionMode,
        options: McpToolLoadOptions = {},
    ): Promise<McpToolLoadResult> {
        if (permissionMode !== "auto" && permissionMode !== "full_access") {
            return this.#loadBlockedServerSummaries(cwd);
        }
        const entries = await this.#loadEntries(cwd);
        const connectionKey = `${cwd}\0${entries
            .map(
                (entry) =>
                    `${fingerprintMcpServer(entry, cwd)}:${entry.projectShadowed === true ? "shadowed" : "selected"}`,
            )
            .sort()
            .join("\0")}`;
        const previousKey = this.#connectionKeysByCwd.get(cwd);
        if (previousKey !== undefined && previousKey !== connectionKey) {
            const previous = this.#connectionSets.get(previousKey);
            this.#connectionSets.delete(previousKey);
            this.#connectionKeysByCwd.delete(cwd);
            if (previous !== undefined) await this.#retireConnectionSet(previous);
        }
        let pending = this.#connectionSets.get(connectionKey);
        if (pending === undefined) {
            pending = this.#loadConnectionSet(cwd, entries, options);
            this.#allConnectionSets.add(pending);
            this.#connectionSets.set(connectionKey, pending);
            this.#connectionKeysByCwd.set(cwd, connectionKey);
        }
        const release = this.#retainConnectionSet(pending);
        let loaded: LoadedConnectionSet;
        try {
            loaded = await pending;
        } catch (error) {
            this.#evictConnectionSet(cwd, connectionKey, pending);
            await release();
            await this.#closeConnectionSet(pending);
            throw error;
        }
        if (!loaded.cacheable) {
            this.#evictConnectionSet(cwd, connectionKey, pending);
            await release();
            await this.#closeConnectionSet(pending);
            return { servers: loaded.servers, tools: loaded.tools };
        }
        return { release, servers: loaded.servers, tools: loaded.tools };
    }

    #evictConnectionSet(
        cwd: string,
        connectionKey: string,
        pending: Promise<LoadedConnectionSet>,
    ): void {
        if (this.#connectionSets.get(connectionKey) !== pending) return;
        this.#connectionSets.delete(connectionKey);
        if (this.#connectionKeysByCwd.get(cwd) === connectionKey) {
            this.#connectionKeysByCwd.delete(cwd);
        }
    }

    async close(): Promise<void> {
        const sets = [...this.#allConnectionSets];
        this.#connectionSets.clear();
        this.#connectionKeysByCwd.clear();
        await Promise.allSettled(sets.map((set) => this.#closeConnectionSet(set)));
        this.#connectionReferences.clear();
        this.#retiredConnectionSets.clear();
    }

    #retainConnectionSet(pending: Promise<LoadedConnectionSet>): () => Promise<void> {
        this.#connectionReferences.set(pending, (this.#connectionReferences.get(pending) ?? 0) + 1);
        let released = false;
        return async () => {
            if (released) return;
            released = true;
            const remaining = (this.#connectionReferences.get(pending) ?? 1) - 1;
            if (remaining > 0) {
                this.#connectionReferences.set(pending, remaining);
                return;
            }
            this.#connectionReferences.delete(pending);
            if (this.#retiredConnectionSets.delete(pending)) {
                await this.#closeConnectionSet(pending);
            }
        };
    }

    async #retireConnectionSet(pending: Promise<LoadedConnectionSet>): Promise<void> {
        if ((this.#connectionReferences.get(pending) ?? 0) > 0) {
            this.#retiredConnectionSets.add(pending);
            return;
        }
        await this.#closeConnectionSet(pending);
    }

    async #closeConnectionSet(pending: Promise<LoadedConnectionSet>): Promise<void> {
        let closing = this.#closingConnectionSets.get(pending);
        if (closing === undefined) {
            closing = closeConnectionSet(pending).finally(() => {
                this.#allConnectionSets.delete(pending);
                this.#closingConnectionSets.delete(pending);
                this.#connectionReferences.delete(pending);
                this.#retiredConnectionSets.delete(pending);
            });
            this.#closingConnectionSets.set(pending, closing);
        }
        await closing;
    }

    async #loadConnectionSet(
        cwd: string,
        entries: readonly McpServerConfigEntry[],
        options: McpToolLoadOptions,
    ): Promise<LoadedConnectionSet> {
        const sortedEntries = [...entries].sort((left, right) =>
            left.name.localeCompare(right.name),
        );
        const blockedSummaries: McpServerSummary[] = sortedEntries
            .filter((entry) => entry.projectShadowed === true)
            .map((entry) => ({
                errorMessage: PROJECT_SHADOWED_REASON,
                name: `${entry.name} (project configuration)`,
                status: "blocked" as const,
                toolCount: 0,
            }));
        const disabledSummaries: McpServerSummary[] = entries
            .filter((entry) => entry.config.enabled === false)
            .map((entry) => ({ name: entry.name, status: "disabled", toolCount: 0 }));
        const trustedEntries: McpServerConfigEntry[] = [];
        let hasUnresolvedTrust = false;
        for (const entry of sortedEntries.filter((entry) => entry.config.enabled !== false)) {
            const fingerprint = fingerprintMcpServer(entry, cwd);
            let decision = await this.#trustStore.decision(fingerprint);
            if (decision === undefined && options.requestTrust !== undefined) {
                decision = await options.requestTrust({
                    config: entry.config,
                    ...(entry.config.transport === "stdio"
                        ? {
                              effectiveCwd:
                                  entry.config.cwd === undefined
                                      ? (this.#homeDirectory ?? homedir())
                                      : resolve(this.#homeDirectory ?? homedir(), entry.config.cwd),
                          }
                        : {}),
                    fingerprint,
                    name: entry.name,
                    source: entry.source,
                });
                await this.#trustStore.remember(fingerprint, decision);
            }
            if (decision === true) {
                trustedEntries.push(entry);
            } else {
                if (decision === undefined) hasUnresolvedTrust = true;
                blockedSummaries.push({
                    errorMessage:
                        decision === undefined ? MCP_TRUST_REQUIRED_REASON : MCP_NOT_TRUSTED_REASON,
                    name: entry.name,
                    status: "blocked",
                    toolCount: 0,
                });
            }
        }

        if (hasUnresolvedTrust) {
            for (const entry of trustedEntries) {
                blockedSummaries.push({
                    errorMessage: "MCP loading is waiting for the remaining trust decisions.",
                    name: entry.name,
                    status: "blocked",
                    toolCount: 0,
                });
            }
            return {
                cacheable: false,
                connections: [],
                servers: [...blockedSummaries, ...disabledSummaries].sort((left, right) =>
                    left.name.localeCompare(right.name),
                ),
                tools: [],
            };
        }
        const results = await Promise.all(
            trustedEntries.map((entry) => this.#connectServer(entry.name, entry.config, cwd)),
        );

        const connections: ConnectedMcpServer[] = [];
        const protocolConnections: Array<{
            client: Client;
            disabledTools?: readonly string[];
            enabledTools?: readonly string[];
            name: string;
            timeoutMs?: number;
        }> = [];
        const servers: McpServerSummary[] = [...blockedSummaries, ...disabledSummaries];
        const tools: McpToolLoadResult["tools"][number][] = [];
        const toolNames = new Set<string>();
        for (const result of results) {
            if ("errorMessage" in result) {
                servers.push({
                    errorMessage: result.errorMessage,
                    name: result.name,
                    status: "failed",
                    toolCount: 0,
                });
                continue;
            }
            const serverTools = result.tools.map((tool) =>
                createMcpTool({
                    client: result.connection.client,
                    serverName: result.name,
                    tool,
                    ...(result.config.toolTimeoutMs !== undefined
                        ? { timeoutMs: result.config.toolTimeoutMs }
                        : {}),
                }),
            );
            const duplicate = serverTools.find((tool) => toolNames.has(tool.name));
            const duplicateInsideServer =
                new Set(serverTools.map((tool) => tool.name)).size !== serverTools.length;
            if (duplicate !== undefined || duplicateInsideServer) {
                await result.connection.close().catch(() => undefined);
                servers.push({
                    errorMessage: `MCP tool names collide after normalization for server "${result.name}".`,
                    name: result.name,
                    status: "failed",
                    toolCount: 0,
                });
                continue;
            }
            connections.push(result.connection);
            protocolConnections.push({
                client: result.connection.client,
                ...(result.config.disabledTools === undefined
                    ? {}
                    : { disabledTools: result.config.disabledTools }),
                ...(result.config.enabledTools === undefined
                    ? {}
                    : { enabledTools: result.config.enabledTools }),
                name: result.name,
                ...(result.config.toolTimeoutMs === undefined
                    ? {}
                    : { timeoutMs: result.config.toolTimeoutMs }),
            });
            for (const tool of serverTools) {
                toolNames.add(tool.name);
                tools.push(tool);
            }
            servers.push({
                name: result.name,
                promptSupport:
                    result.connection.client.getServerCapabilities()?.prompts !== undefined,
                resourceSupport:
                    result.connection.client.getServerCapabilities()?.resources !== undefined,
                status: "connected",
                toolCount: serverTools.length,
            });
        }

        if (protocolConnections.length > 0) {
            tools.push(...createMcpProtocolTools(protocolConnections));
        }

        servers.sort((left, right) => left.name.localeCompare(right.name));
        return { cacheable: true, connections, servers, tools };
    }

    async #loadBlockedServerSummaries(cwd: string): Promise<McpToolLoadResult> {
        const entries = await this.#loadEntries(cwd);
        const servers: McpServerSummary[] = [];
        for (const entry of [...entries].sort((left, right) =>
            left.name.localeCompare(right.name),
        )) {
            if (entry.projectShadowed === true) {
                servers.push({
                    errorMessage: PROJECT_SHADOWED_REASON,
                    name: `${entry.name} (project configuration)`,
                    status: "blocked",
                    toolCount: 0,
                });
            }
            if (entry.config.enabled === false) {
                servers.push({ name: entry.name, status: "disabled", toolCount: 0 });
            } else {
                servers.push({
                    errorMessage: RESTRICTED_MCP_BLOCKED_REASON,
                    name: entry.name,
                    status: "blocked",
                    toolCount: 0,
                });
            }
        }
        return { servers, tools: [] };
    }

    #loadEntries(cwd: string): Promise<readonly McpServerConfigEntry[]> {
        return loadMcpServerConfigEntries(cwd, {
            env: this.#env,
            ...(this.#homeDirectory !== undefined ? { homeDirectory: this.#homeDirectory } : {}),
        });
    }

    async #connectServer(
        name: string,
        config: McpServerConfig,
        cwd: string,
    ): Promise<ServerResult> {
        let connection: ConnectedMcpServer | undefined;
        try {
            connection = await connectMcpServer(
                name,
                config,
                cwd,
                this.#homeDirectory ?? homedir(),
                this.#env,
            );
            const tools = await listAllTools(connection.client, config.startupTimeoutMs ?? 10_000);
            const enabled =
                config.enabledTools === undefined ? undefined : new Set(config.enabledTools);
            const disabled = new Set(config.disabledTools ?? []);
            return {
                config,
                connection,
                name,
                tools: tools.filter(
                    (tool) =>
                        (enabled === undefined || enabled.has(tool.name)) &&
                        !disabled.has(tool.name),
                ),
            };
        } catch (error) {
            await connection?.close().catch(() => undefined);
            return {
                errorMessage: errorToMessage(error),
                name,
            };
        }
    }
}

async function closeConnectionSet(pending: Promise<LoadedConnectionSet>): Promise<void> {
    try {
        const loaded = await pending;
        await Promise.allSettled(loaded.connections.map((connection) => connection.close()));
    } catch {
        // A failed connection set has already closed any partially started servers.
    }
}

async function listAllTools(
    client: Client,
    timeout: number,
): Promise<Awaited<ReturnType<Client["listTools"]>>["tools"]> {
    const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
    let cursor: string | undefined;
    do {
        const page = await client.listTools(cursor === undefined ? undefined : { cursor }, {
            timeout,
        });
        tools.push(...page.tools);
        cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
}
