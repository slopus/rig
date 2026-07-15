import { loadConfig } from "./loadConfig.js";
import type { DaemonSettings, LoadConfigOptions, PartialRigConfig } from "./types.js";
import { writeRuntimeConfig } from "./writeRuntimeConfig.js";

export async function writeDaemonSettings(
    settings: DaemonSettings,
    options: LoadConfigOptions = {},
): Promise<void> {
    const loaded = await loadConfig(options);
    const runtime = loaded.sources.runtime.values;
    const updated: PartialRigConfig = {
        ...(runtime.defaults === undefined ? {} : { defaults: runtime.defaults }),
        ...(runtime.providers === undefined ? {} : { providers: runtime.providers }),
        settings: {
            ...runtime.settings,
            durableGlobalEventQueue: settings.durableGlobalEventQueue,
        },
    };
    await writeRuntimeConfig(loaded.paths.runtime, updated);
}
