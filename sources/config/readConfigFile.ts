import { readFile } from "node:fs/promises";

import { parseConfigToml } from "./parseConfigToml.js";
import type { ConfigSource } from "./types.js";

export async function readConfigFile(path: string): Promise<ConfigSource> {
  try {
    const source = await readFile(path, "utf8");
    return {
      exists: true,
      path,
      values: parseConfigToml(source),
    };
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return {
        exists: false,
        path,
        values: {},
      };
    }
    throw error;
  }
}
