import { parse, TomlDate, type TomlTable, type TomlValue } from "smol-toml";

import type { PartialConfigDefaults, PartialOhMyPiConfig } from "./types.js";

export function parseConfigToml(source: string): PartialOhMyPiConfig {
  const defaults: PartialConfigDefaults = {};
  const table = parse(source);
  const defaultsTable = table.defaults;

  if (!isTomlTable(defaultsTable)) {
    return {};
  }

  const modelId = readString(defaultsTable, "model");
  if (modelId !== undefined) {
    defaults.modelId = modelId;
  }

  const effort = readString(defaultsTable, "effort");
  if (effort !== undefined) {
    defaults.effort = effort;
  }

  const instructions = readString(defaultsTable, "instructions");
  if (instructions !== undefined) {
    defaults.instructions = instructions;
  }

  return Object.keys(defaults).length === 0 ? {} : { defaults };
}

function isTomlTable(value: TomlValue | undefined): value is TomlTable {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof TomlDate)
  );
}

function readString(table: TomlTable, key: string): string | undefined {
  const value = table[key];
  return typeof value === "string" ? value : undefined;
}
