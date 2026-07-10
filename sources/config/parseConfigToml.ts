import { parse, TomlDate, type TomlTable, type TomlValue } from "smol-toml";

import type { PartialConfigDefaults, PartialConfigSettings, PartialRigConfig } from "./types.js";

export function parseConfigToml(source: string): PartialRigConfig {
    const defaults: PartialConfigDefaults = {};
    const settings: PartialConfigSettings = {};
    const table = parse(source);
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
    }

    const settingsTable = table.settings;
    if (isTomlTable(settingsTable)) {
        const showReasoning = readBoolean(settingsTable, "show_reasoning");
        if (showReasoning !== undefined) {
            settings.showReasoning = showReasoning;
        }
    }

    return {
        ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
        ...(Object.keys(settings).length > 0 ? { settings } : {}),
    };
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
