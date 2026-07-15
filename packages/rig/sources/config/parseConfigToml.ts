import { parse, TomlDate, type TomlTable, type TomlValue } from "smol-toml";

import type {
    ConfigProvider,
    PartialConfigDefaults,
    PartialConfigFeatures,
    PartialConfigSettings,
    PartialConfigTheme,
    PartialRigConfig,
} from "./types.js";
import type { McpServerConfig } from "../mcp/types.js";
import { isPermissionMode, type PermissionMode } from "../permissions/index.js";
import type {
    BedrockModelOverride,
    BedrockModelOverrides,
} from "../providers/bedrock-model-overrides.js";
import type { DockerExecutionConfig, DockerMountConfig } from "../execution/index.js";

export function parseConfigToml(source: string): PartialRigConfig {
    const defaults: PartialConfigDefaults = {};
    const features: PartialConfigFeatures = {};
    const settings: PartialConfigSettings = {};
    const theme: PartialConfigTheme = {};
    const table = parse(source);
    const docker = readDockerConfig(table.docker);
    const defaultsTable = table.defaults;

    if (isTomlTable(defaultsTable)) {
        const modelId = readString(defaultsTable, "model");
        if (modelId !== undefined) {
            defaults.modelId = modelId;
        }

        const providerId = readString(defaultsTable, "provider");
        if (providerId !== undefined) {
            defaults.providerId = providerId;
        }

        const effort = readString(defaultsTable, "effort");
        if (effort !== undefined) {
            defaults.effort = effort;
        }

        const instructions = readString(defaultsTable, "instructions");
        if (instructions !== undefined) {
            defaults.instructions = instructions;
        }

        const permissionMode = readPermissionMode(defaultsTable, "permission_mode");
        if (permissionMode !== undefined) defaults.permissionMode = permissionMode;

        const serviceTier = readString(defaultsTable, "service_tier");
        if (serviceTier === "fast") defaults.serviceTier = serviceTier;
        else if (serviceTier === "default") defaults.serviceTier = null;
        else if (serviceTier !== undefined) {
            throw new Error('defaults.service_tier must be "fast" or "default".');
        }
    }

    const themeTable = table.theme;
    if (isTomlTable(themeTable)) {
        for (const role of [
            "accent",
            "brand",
            "error",
            "primary",
            "secondary",
            "success",
            "warning",
        ] as const) {
            const value = readString(themeTable, role);
            if (value !== undefined) theme[role] = value;
        }
    }

    const settingsTable = table.settings;
    if (isTomlTable(settingsTable)) {
        const durableGlobalEventQueue = readBoolean(settingsTable, "durable_global_event_queue");
        if (durableGlobalEventQueue !== undefined) {
            settings.durableGlobalEventQueue = durableGlobalEventQueue;
        }
        const showReasoning = readBoolean(settingsTable, "show_reasoning");
        if (showReasoning !== undefined) {
            settings.showReasoning = showReasoning;
        }
        const showUsage = readBoolean(settingsTable, "show_usage");
        if (showUsage !== undefined) settings.showUsage = showUsage;
    }

    const providers = readProviders(table.providers);

    const mcpServers = readMcpServers(table.mcp_servers);
    const featuresTable = table.features;
    if (isTomlTable(featuresTable)) {
        const workflows = readBoolean(featuresTable, "workflows");
        if (workflows !== undefined) features.workflows = workflows;
    }

    return {
        ...(docker !== undefined ? { docker } : {}),
        ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
        ...(Object.keys(features).length > 0 ? { features } : {}),
        ...(mcpServers !== undefined ? { mcpServers } : {}),
        ...(providers !== undefined ? { providers } : {}),
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
        ...(Object.keys(theme).length > 0 ? { theme } : {}),
    };
}

function readProviders(value: TomlValue | undefined): Record<string, ConfigProvider> | undefined {
    if (value === undefined) return undefined;
    if (!isTomlTable(value)) throw new Error("providers must be a TOML table.");

    const providers: Record<string, ConfigProvider> = {};
    for (const [id, rawProvider] of Object.entries(value)) {
        if (!isTomlTable(rawProvider)) {
            throw new Error(`Provider "${id}" must be a TOML table.`);
        }
        const type = readProviderType(id, rawProvider);
        const enabledValue = rawProvider.enabled;
        if (enabledValue !== undefined && typeof enabledValue !== "boolean") {
            throw new Error(`providers.${id}.enabled must be a boolean.`);
        }
        const common = {
            enabled: enabledValue ?? true,
            ...readOptionalStringArray(rawProvider, "exclude_models", "excludeModels"),
            ...readOptionalStringArray(rawProvider, "include_models", "includeModels"),
        };
        if (type === "codex") {
            assertKnownKeys(id, rawProvider, [
                "auth_file",
                "base_url",
                "enabled",
                "exclude_models",
                "include_models",
                "transport",
                "type",
            ]);
            const authFile = readProviderString(id, rawProvider, "auth_file");
            const baseUrl = readProviderString(id, rawProvider, "base_url");
            const transport = readProviderString(id, rawProvider, "transport");
            if (
                transport !== undefined &&
                !["auto", "sse", "websocket", "websocket-cached"].includes(transport)
            ) {
                throw new Error(
                    `providers.${id}.transport must be "auto", "sse", "websocket", or "websocket-cached".`,
                );
            }
            providers[id] = {
                ...common,
                ...(authFile === undefined ? {} : { authFile }),
                ...(baseUrl === undefined ? {} : { baseUrl }),
                ...(transport === undefined
                    ? {}
                    : {
                          transport: transport as "auto" | "sse" | "websocket" | "websocket-cached",
                      }),
                type,
            };
            continue;
        }

        if (type === "grok") {
            assertKnownKeys(id, rawProvider, [
                "auth_file",
                "base_url",
                "enabled",
                "exclude_models",
                "include_models",
                "type",
            ]);
            const authFile = readProviderString(id, rawProvider, "auth_file");
            const baseUrl = readProviderString(id, rawProvider, "base_url");
            providers[id] = {
                ...common,
                ...(authFile === undefined ? {} : { authFile }),
                ...(baseUrl === undefined ? {} : { baseUrl }),
                type,
            };
            continue;
        }

        if (type === "claude") {
            assertKnownKeys(id, rawProvider, [
                "config_dir",
                "enabled",
                "exclude_models",
                "executable",
                "include_models",
                "type",
            ]);
            const configDir = readProviderString(id, rawProvider, "config_dir");
            const executable = readProviderString(id, rawProvider, "executable");
            providers[id] = {
                ...common,
                ...(configDir === undefined ? {} : { configDir }),
                ...(executable === undefined ? {} : { executable }),
                type,
            };
            continue;
        }

        assertKnownKeys(id, rawProvider, [
            "bearer_token_env_var",
            "enabled",
            "exclude_models",
            "include_models",
            "model_overrides",
            "region",
            "type",
        ]);
        const bearerTokenEnvVar = readProviderString(id, rawProvider, "bearer_token_env_var");
        const modelOverrides = readBedrockModelOverrides(id, rawProvider);
        const region = readProviderString(id, rawProvider, "region");
        providers[id] = {
            ...common,
            ...(bearerTokenEnvVar === undefined ? {} : { bearerTokenEnvVar }),
            ...(modelOverrides === undefined ? {} : { modelOverrides }),
            ...(region === undefined ? {} : { region }),
            type,
        };
    }
    return providers;
}

function readProviderType(id: string, table: TomlTable): "bedrock" | "claude" | "codex" | "grok" {
    const configuredType = readProviderString(id, table, "type");
    const builtInType =
        id === "bedrock" || id === "claude" || id === "codex" || id === "grok" ? id : undefined;
    if (
        configuredType !== undefined &&
        builtInType !== undefined &&
        configuredType !== builtInType
    ) {
        throw new Error(`Built-in provider "${id}" must use type "${builtInType}".`);
    }
    const type = configuredType ?? builtInType;
    if (type !== "bedrock" && type !== "claude" && type !== "codex" && type !== "grok") {
        throw new Error(
            `Provider "${id}" must set type to "codex", "claude", "grok", or "bedrock".`,
        );
    }
    return type;
}

function readProviderString(id: string, table: TomlTable, key: string): string | undefined {
    const value = table[key];
    if (value !== undefined && typeof value !== "string") {
        throw new Error(`providers.${id}.${key} must be a string.`);
    }
    return value;
}

function assertKnownKeys(id: string, table: TomlTable, keys: readonly string[]): void {
    const unknownKey = Object.keys(table).find((key) => !keys.includes(key));
    if (unknownKey !== undefined) {
        throw new Error(`Unknown providers.${id}.${unknownKey} setting.`);
    }
}

function readBedrockModelOverrides(
    providerId: string,
    table: TomlTable,
): BedrockModelOverrides | undefined {
    const value = table.model_overrides;
    if (value === undefined) return undefined;
    if (!isTomlTable(value)) {
        throw new Error(`providers.${providerId}.model_overrides must be a TOML table.`);
    }

    const overrides: Record<string, BedrockModelOverride> = {};
    for (const [modelId, rawOverride] of Object.entries(value)) {
        if (!isTomlTable(rawOverride)) {
            throw new Error(
                `providers.${providerId}.model_overrides.${modelId} must be a TOML table.`,
            );
        }
        const unknownKey = Object.keys(rawOverride).find(
            (key) => key !== "endpoint" && key !== "region",
        );
        if (unknownKey !== undefined) {
            throw new Error(
                `Unknown providers.${providerId}.model_overrides.${modelId}.${unknownKey} setting.`,
            );
        }
        const endpoint = readBedrockModelOverrideString(
            providerId,
            modelId,
            rawOverride,
            "endpoint",
        );
        const region = readBedrockModelOverrideString(providerId, modelId, rawOverride, "region");
        overrides[modelId] = {
            ...(endpoint === undefined ? {} : { endpoint }),
            ...(region === undefined ? {} : { region }),
        };
    }
    return overrides;
}

function readBedrockModelOverrideString(
    providerId: string,
    modelId: string,
    table: TomlTable,
    key: "endpoint" | "region",
): string | undefined {
    const value = table[key];
    if (value !== undefined && typeof value !== "string") {
        throw new Error(
            `providers.${providerId}.model_overrides.${modelId}.${key} must be a string.`,
        );
    }
    return value;
}

function readDockerConfig(value: TomlValue | undefined): DockerExecutionConfig | undefined {
    if (value === undefined) return undefined;
    if (!isTomlTable(value)) throw new Error("docker must be a TOML table.");

    const container = readString(value, "container");
    const image = readString(value, "image");
    if ((container === undefined) === (image === undefined)) {
        throw new Error('docker must configure exactly one of "container" or "image".');
    }
    const workingDirectory = readString(value, "workdir") ?? "/workspace";
    if (!workingDirectory.startsWith("/")) {
        throw new Error("docker.workdir must be an absolute container path.");
    }
    const mounts = readDockerMounts(value.mounts);
    const environment = readOptionalStringRecord(value, "env", "environment").environment;
    const name = readString(value, "name");
    if (
        container !== undefined &&
        (environment !== undefined || mounts !== undefined || name !== undefined)
    ) {
        throw new Error("docker env, mounts, and name can only be used when docker.image is set.");
    }
    return {
        ...(container === undefined ? {} : { container }),
        ...(environment === undefined ? {} : { environment }),
        ...(image === undefined ? {} : { image }),
        ...(mounts === undefined ? {} : { mounts }),
        ...(name === undefined ? {} : { name }),
        ...readOptionalString(value, "socket_path", "socketPath"),
        workingDirectory,
    };
}

function readDockerMounts(value: TomlValue | undefined): readonly DockerMountConfig[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new Error("docker.mounts must be an array of tables.");
    return value.map((entry, index) => {
        if (!isTomlTable(entry)) {
            throw new Error(`docker.mounts[${index}] must be a TOML table.`);
        }
        const source = readString(entry, "source");
        const target = readString(entry, "target");
        if (source === undefined || target === undefined) {
            throw new Error(`docker.mounts[${index}] requires string source and target values.`);
        }
        if (!target.startsWith("/")) {
            throw new Error(`docker.mounts[${index}].target must be an absolute container path.`);
        }
        const readOnly = entry.read_only;
        if (readOnly !== undefined && typeof readOnly !== "boolean") {
            throw new Error(`docker.mounts[${index}].read_only must be a boolean.`);
        }
        return { source, target, ...(readOnly === undefined ? {} : { readOnly }) };
    });
}

function readMcpServers(value: TomlValue | undefined): Record<string, McpServerConfig> | undefined {
    if (!isTomlTable(value)) return undefined;
    const servers: Record<string, McpServerConfig> = {};
    for (const [name, rawServer] of Object.entries(value)) {
        if (!isTomlTable(rawServer)) {
            throw new Error(`MCP server "${name}" must be a TOML table.`);
        }
        servers[name] = readMcpServer(name, rawServer);
    }
    return servers;
}

function readMcpServer(name: string, table: TomlTable): McpServerConfig {
    const command = readString(table, "command");
    const url = readString(table, "url");
    const transport = readString(table, "transport");
    if (transport !== undefined && transport !== "http" && transport !== "sse") {
        throw new Error(`MCP server "${name}" uses unsupported transport "${transport}".`);
    }
    if ((command === undefined) === (url === undefined)) {
        throw new Error(`MCP server "${name}" must configure either command or url.`);
    }

    const common = {
        ...readOptionalBoolean(table, "enabled"),
        ...readOptionalSeconds(table, "startup_timeout_sec", "startupTimeoutMs"),
        ...readOptionalSeconds(table, "tool_timeout_sec", "toolTimeoutMs"),
        ...readOptionalStringArray(table, "enabled_tools", "enabledTools"),
        ...readOptionalStringArray(table, "disabled_tools", "disabledTools"),
    };
    if (command !== undefined) {
        return {
            ...common,
            ...readOptionalStringArray(table, "args", "args"),
            ...readOptionalStringRecord(table, "env", "env"),
            ...readOptionalString(table, "cwd", "cwd"),
            command,
            transport: "stdio",
        };
    }
    return {
        ...common,
        ...readOptionalStringRecord(table, "http_headers", "headers"),
        ...readOptionalString(table, "bearer_token_env_var", "bearerTokenEnvVar"),
        ...readOptionalString(table, "oauth_client_id_env_var", "oauthClientIdEnvVar"),
        ...readOptionalString(table, "oauth_client_secret_env_var", "oauthClientSecretEnvVar"),
        ...readOptionalStringArray(table, "oauth_scopes", "oauthScopes"),
        transport: transport === "sse" ? "sse" : "http",
        url: url ?? "",
    };
}

function readOptionalBoolean(table: TomlTable, key: string): { enabled?: boolean } {
    const value = table[key];
    return typeof value === "boolean" ? { enabled: value } : {};
}

function readOptionalSeconds<TKey extends "startupTimeoutMs" | "toolTimeoutMs">(
    table: TomlTable,
    key: string,
    outputKey: TKey,
): Partial<Record<TKey, number>> {
    const value = table[key];
    if (value === undefined) return {};
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${key} must be a positive number.`);
    }
    return { [outputKey]: value * 1_000 } as Partial<Record<TKey, number>>;
}

function readOptionalString<TKey extends string>(
    table: TomlTable,
    key: string,
    outputKey: TKey,
): Partial<Record<TKey, string>> {
    const value = readString(table, key);
    return value === undefined ? {} : ({ [outputKey]: value } as Partial<Record<TKey, string>>);
}

function readOptionalStringArray<TKey extends string>(
    table: TomlTable,
    key: string,
    outputKey: TKey,
): Partial<Record<TKey, readonly string[]>> {
    const value = table[key];
    if (value === undefined) return {};
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error(`${key} must be an array of strings.`);
    }
    return { [outputKey]: value } as unknown as Partial<Record<TKey, readonly string[]>>;
}

function readOptionalStringRecord<TKey extends string>(
    table: TomlTable,
    key: string,
    outputKey: TKey,
): Partial<Record<TKey, Readonly<Record<string, string>>>> {
    const value = table[key];
    if (value === undefined) return {};
    if (!isTomlTable(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
        throw new Error(`${key} must contain string values.`);
    }
    return { [outputKey]: value as Record<string, string> } as Partial<
        Record<TKey, Readonly<Record<string, string>>>
    >;
}

function readPermissionMode(table: TomlTable, key: string): PermissionMode | undefined {
    const value = readString(table, key);
    return isPermissionMode(value) ? value : undefined;
}

function isTomlTable(value: TomlValue | undefined): value is TomlTable {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof TomlDate)
    );
}

function readString(table: TomlTable, key: string): string | undefined {
    const value = table[key];
    return typeof value === "string" ? value : undefined;
}

function readBoolean(table: TomlTable, key: string): boolean | undefined {
    const value = table[key];
    return typeof value === "boolean" ? value : undefined;
}
