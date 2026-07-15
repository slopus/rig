import type { PermissionMode } from "../permissions/index.js";
import type { McpServerConfig } from "../mcp/types.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import type { ServiceTier } from "../providers/types.js";
import type { BedrockModelOverrides } from "../providers/bedrock-model-overrides.js";

export interface ConfigDefaults {
    effort?: string;
    instructions?: string;
    modelId: string;
    providerId?: string;
    permissionMode: PermissionMode;
    serviceTier?: ServiceTier;
}

export interface PartialConfigDefaults {
    effort?: string;
    instructions?: string;
    modelId?: string;
    providerId?: string;
    permissionMode?: PermissionMode;
    serviceTier?: ServiceTier | null;
}

export interface ConfigSettings {
    durableGlobalEventQueue: boolean;
    showReasoning: boolean;
    showUsage: boolean;
}

export interface PartialConfigSettings {
    durableGlobalEventQueue?: boolean;
    showReasoning?: boolean;
    showUsage?: boolean;
}

export interface ConfigFeatures {
    workflows: boolean;
}

export interface PartialConfigFeatures {
    workflows?: boolean;
}

interface ConfigProviderBase {
    enabled: boolean;
    excludeModels?: readonly string[];
    includeModels?: readonly string[];
}

export interface ConfigBedrockProvider extends ConfigProviderBase {
    bearerTokenEnvVar?: string;
    modelOverrides?: BedrockModelOverrides;
    region?: string;
    type: "bedrock";
}

export interface ConfigClaudeProvider extends ConfigProviderBase {
    configDir?: string;
    executable?: string;
    type: "claude";
}

export interface ConfigCodexProvider extends ConfigProviderBase {
    authFile?: string;
    baseUrl?: string;
    transport?: "auto" | "sse" | "websocket" | "websocket-cached";
    type: "codex";
}

export type ConfigProvider = ConfigBedrockProvider | ConfigClaudeProvider | ConfigCodexProvider;

export type ConfigProviders = Readonly<Record<string, ConfigProvider>>;

export type PartialConfigProviders = ConfigProviders;

export interface ConfigTheme {
    accent: string;
    brand: string;
    error: string;
    primary: string;
    secondary: string;
    success: string;
    warning: string;
}

export type PartialConfigTheme = Partial<ConfigTheme>;

export interface RigConfig {
    docker?: DockerExecutionConfig;
    defaults: ConfigDefaults;
    features: ConfigFeatures;
    mcpServers: Readonly<Record<string, McpServerConfig>>;
    providers: ConfigProviders;
    settings: ConfigSettings;
    theme: ConfigTheme;
}

export interface PartialRigConfig {
    docker?: DockerExecutionConfig;
    defaults?: PartialConfigDefaults;
    features?: PartialConfigFeatures;
    mcpServers?: Readonly<Record<string, McpServerConfig>>;
    providers?: PartialConfigProviders;
    settings?: PartialConfigSettings;
    theme?: PartialConfigTheme;
}

export interface ConfigPaths {
    global: string;
    local: string;
    runtime: string;
}

export interface ConfigSource {
    exists: boolean;
    path: string;
    values: PartialRigConfig;
}

export interface LoadedConfig {
    config: RigConfig;
    paths: ConfigPaths;
    sources: {
        global: ConfigSource;
        local: ConfigSource;
        runtime: ConfigSource;
    };
}

export interface LoadConfigOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    homeDirectory?: string;
}

export interface DaemonSettings {
    durableGlobalEventQueue: boolean;
}
