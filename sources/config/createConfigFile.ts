import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify } from "smol-toml";

import { DEFAULT_OHMYPI_CONFIG } from "./defaultConfig.js";
import type { OhMyPiConfig } from "./types.js";

export async function createConfigFile(
  path: string,
  config: OhMyPiConfig = DEFAULT_OHMYPI_CONFIG,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringify({
    defaults: {
      model: config.defaults.modelId,
      ...(config.defaults.effort !== undefined
        ? { effort: config.defaults.effort }
        : {}),
      ...(config.defaults.instructions !== undefined
        ? { instructions: config.defaults.instructions }
        : {}),
    },
  }), { encoding: "utf8", flag: "wx" });
}
