export interface ConfigDefaults {
    effort?: string;
    instructions?: string;
    modelId: string;
    providerId?: string;
}

export interface PartialConfigDefaults {
    effort?: string;
    instructions?: string;
    modelId?: string;
    providerId?: string;
}

export interface ConfigSettings {
    showReasoning: boolean;
}

export interface PartialConfigSettings {
    showReasoning?: boolean;
}

export interface OhMyPiConfig {
    defaults: ConfigDefaults;
    settings: ConfigSettings;
}

export interface PartialOhMyPiConfig {
    defaults?: PartialConfigDefaults;
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
    values: PartialOhMyPiConfig;
}

export interface LoadedConfig {
    config: OhMyPiConfig;
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
