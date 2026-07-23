import type { ConfigProviders } from "../config/types.js";
import type { ProviderModelCatalog } from "../protocol/index.js";
import { hasConfiguredProviderAuthentication } from "./hasConfiguredProviderAuthentication.js";

export async function resolveProviderDisabledReasons(
    providers: ConfigProviders,
    env: NodeJS.ProcessEnv,
): Promise<ReadonlyMap<string, NonNullable<ProviderModelCatalog["disabledReason"]>>> {
    const entries = await Promise.all(
        Object.entries(providers).map(async ([id, config]) => {
            if (!config.enabled) return [id, "not_enabled"] as const;
            return (await hasConfiguredProviderAuthentication({ config, env }))
                ? undefined
                : ([id, "not_authenticated"] as const);
        }),
    );
    return new Map(entries.filter((entry) => entry !== undefined));
}
