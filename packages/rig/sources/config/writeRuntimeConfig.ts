import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify } from "smol-toml";

import type { PartialRigConfig } from "./types.js";
import { serializeProviders } from "./serializeProviders.js";

export async function writeRuntimeConfig(path: string, config: PartialRigConfig): Promise<void> {
    const defaults = config.defaults;
    const settings = config.settings;
    const providers = config.providers;
    const theme = config.theme;
    const document: {
        defaults?: {
            effort?: string;
            instructions?: string;
            model?: string;
            provider?: string;
            permission_mode?: string;
            service_tier?: string;
        };
        theme?: Record<string, string>;
        settings?: {
            compact_completed_turns?: boolean;
            completion_chime?: boolean;
            durable_global_event_queue?: boolean;
            happy_integration?: boolean;
            show_reasoning?: boolean;
            show_usage?: boolean;
        };
        providers?: Record<string, unknown>;
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
        if (defaults.permissionMode !== undefined) {
            document.defaults.permission_mode = defaults.permissionMode;
        }
        if (defaults.serviceTier !== undefined) {
            document.defaults.service_tier = defaults.serviceTier ?? "default";
        }
    }

    if (settings !== undefined) {
        document.settings = {};
        if (settings.compactCompletedTurns !== undefined) {
            document.settings.compact_completed_turns = settings.compactCompletedTurns;
        }
        if (settings.completionChime !== undefined) {
            document.settings.completion_chime = settings.completionChime;
        }
        if (settings.durableGlobalEventQueue !== undefined) {
            document.settings.durable_global_event_queue = settings.durableGlobalEventQueue;
        }
        if (settings.happyIntegration !== undefined) {
            document.settings.happy_integration = settings.happyIntegration;
        }
        if (settings.showReasoning !== undefined) {
            document.settings.show_reasoning = settings.showReasoning;
        }
        if (settings.showUsage !== undefined) document.settings.show_usage = settings.showUsage;
    }

    if (providers !== undefined || config.providerDefaultEnable !== undefined) {
        document.providers = serializeProviders(providers ?? {}, config.providerDefaultEnable);
    }

    if (theme !== undefined) {
        document.theme = { ...theme };
    }

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stringify(document), "utf8");
}
