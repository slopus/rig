import { DEFAULT_RIG_CONFIG } from "./defaultConfig.js";
import { mergeConfigValues } from "./mergeConfigValues.js";
import { readConfigFile } from "./readConfigFile.js";
import { resolveConfigPaths } from "./resolveConfigPaths.js";
import type { LoadedConfig, LoadConfigOptions } from "./types.js";

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
    const paths = resolveConfigPaths(options);
    const globalSource = await readConfigFile(paths.global);
    const localSource = await readConfigFile(paths.local);
    const runtimeSource = await readConfigFile(paths.runtime);
    const sources = {
        global: globalSource,
        local: localSource,
        runtime: runtimeSource,
    };

    return {
        config: mergeConfigValues(
            DEFAULT_RIG_CONFIG,
            globalSource.values,
            localSource.values,
            runtimeSource.values,
        ),
        paths,
        sources,
    };
}
