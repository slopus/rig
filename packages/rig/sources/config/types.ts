import type { PermissionMode } from "../permissions/index.js";
import type { McpServerConfig } from "../mcp/types.js";
import type { DockerExecutionConfig } from "../execution/index.js";

export interface ConfigDefaults {
    effort?: string;
    instructions?: string;
    modelId: string;
    providerId?: string;
    permissionMode: PermissionMode;
}

export interface PartialConfigDefaults {
    effort?: string;
    instructions?: string;
    modelId?: string;
    providerId?: string;
    permissionMode?: PermissionMode;
}

export interface ConfigSettings {
    showReasoning: boolean;
    showUsage: boolean;
}

export interface PartialConfigSettings {
    showReasoning?: boolean;
    showUsage?: boolean;
}

export interface ConfigFeatures {
    workflows: boolean;
}

export interface PartialConfigFeatures {
    workflows?: boolean;
}

export interface RigConfig {
    docker?: DockerExecutionConfig;
    defaults: ConfigDefaults;
    features: ConfigFeatures;
    mcpServers: Readonly<Record<string, McpServerConfig>>;
    settings: ConfigSettings;
}

export interface PartialRigConfig {
    docker?: DockerExecutionConfig;
    defaults?: PartialConfigDefaults;
    features?: PartialConfigFeatures;
    mcpServers?: Readonly<Record<string, McpServerConfig>>;
    settings?: PartialConfigSettings;
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
