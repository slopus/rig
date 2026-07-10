import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify } from "smol-toml";

import { DEFAULT_RIG_CONFIG } from "./defaultConfig.js";
import type { RigConfig } from "./types.js";

export async function createConfigFile(
    path: string,
    config: RigConfig = DEFAULT_RIG_CONFIG,
): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
        path,
        stringify({
            defaults: {
                model: config.defaults.modelId,
                ...(config.defaults.providerId !== undefined
                    ? { provider: config.defaults.providerId }
                    : {}),
                ...(config.defaults.effort !== undefined ? { effort: config.defaults.effort } : {}),
                ...(config.defaults.instructions !== undefined
                    ? { instructions: config.defaults.instructions }
                    : {}),
            },
            settings: {
                show_reasoning: config.settings.showReasoning,
            },
        }),
        { encoding: "utf8", flag: "wx" },
    );
}
