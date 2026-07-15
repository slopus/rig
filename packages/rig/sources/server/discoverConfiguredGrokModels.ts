import { configuredProviderId } from "../config/configuredProviderId.js";
import type { ConfigProviders } from "../config/types.js";
import { discoverGrokModels } from "../providers/discoverGrokModels.js";
import type { Model } from "../providers/types.js";

export async function discoverConfiguredGrokModels(options: {
    env?: NodeJS.ProcessEnv;
    providers: ConfigProviders;
}): Promise<Readonly<Record<string, readonly Model[]>>> {
    const env = options.env ?? process.env;
    const entries = Object.entries(options.providers).filter(
        ([, provider]) => provider.enabled && provider.type === "grok",
    );
    return Object.fromEntries(
        await Promise.all(
            entries.map(async ([configuredId, provider]) => {
                if (provider.type !== "grok") return [configuredId, []] as const;
                const providerId = configuredProviderId(configuredId, provider);
                const models = await discoverGrokModels({
                    env,
                    ...(provider.authFile === undefined ? {} : { authFile: provider.authFile }),
                    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
                });
                return [providerId, models] as const;
            }),
        ),
    );
}
