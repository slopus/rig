import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify } from "smol-toml";

import type { PartialConfigDefaults } from "./types.js";

export async function writeRuntimeConfigDefaults(
  path: string,
  defaults: PartialConfigDefaults,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringify({
    defaults: {
      ...(defaults.modelId !== undefined ? { model: defaults.modelId } : {}),
      ...(defaults.effort !== undefined ? { effort: defaults.effort } : {}),
      ...(defaults.instructions !== undefined
        ? { instructions: defaults.instructions }
        : {}),
    },
  }), "utf8");
}
