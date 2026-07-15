import { configuredProviderId } from "./configuredProviderId.js";
import type { ConfigProvider, ConfigProviders } from "./types.js";

export function findConfiguredProvider(
    providers: ConfigProviders,
    providerId: string,
): ConfigProvider | undefined {
    const matches = Object.entries(providers).filter(
        ([id, provider]) => configuredProviderId(id, provider) === providerId,
    );
    return (matches.find(([, provider]) => provider.enabled) ?? matches[0])?.[1];
}
