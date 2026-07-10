import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify } from "smol-toml";

import type { PartialRigConfig } from "./types.js";

export async function writeRuntimeConfig(path: string, config: PartialRigConfig): Promise<void> {
    const defaults = config.defaults;
    const settings = config.settings;
    const document: {
        defaults?: {
            effort?: string;
            instructions?: string;
            model?: string;
            provider?: string;
        };
        settings?: {
            show_reasoning?: boolean;
        };
    } = {};

    if (defaults !== undefined) {
        document.defaults = {};
        if (defaults.modelId !== undefined) {
            document.defaults.model = defaults.modelId;
        }
        if (defaults.providerId !== undefined) {
            document.defaults.provider = defaults.providerId;
        }
        if (defaults.effort !== undefined) {
            document.defaults.effort = defaults.effort;
        }
        if (defaults.instructions !== undefined) {
            document.defaults.instructions = defaults.instructions;
        }
    }

    if (settings !== undefined) {
        document.settings = {};
        if (settings.showReasoning !== undefined) {
            document.settings.show_reasoning = settings.showReasoning;
        }
    }

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stringify(document), "utf8");
}
