import type { AgentContext } from "../agent/context/AgentContext.js";
import type { ConfigProviders } from "../config/types.js";
import { createConfiguredProvider } from "../providers/createConfiguredProvider.js";
import { modelXaiGrok45 } from "../providers/models.js";
import { routeProviderThroughGym } from "../providers/routeProviderThroughGym.js";
import { createGrokXSearchTool } from "../tools/grok/x_search.js";

export function createAvailableGrokXSearchTool(options: {
    agentContext: AgentContext;
    agentId: string;
    env: NodeJS.ProcessEnv;
    providers: ConfigProviders;
}) {
    const candidates = Object.entries(options.providers)
        .filter(([, config]) => config.enabled && config.type === "grok")
        .sort(([leftId], [rightId]) => Number(rightId === "grok") - Number(leftId === "grok"));

    for (const [id, config] of candidates) {
        const result = createConfiguredProvider({
            agentContext: options.agentContext,
            config,
            env: options.env,
            id,
            sessionId: `${options.agentId}:x-search`,
        });
        if (result.status !== "available") continue;

        const provider = routeProviderThroughGym(result.provider, options.env);
        if (provider.models.some((model) => model.id === modelXaiGrok45.id)) {
            return createGrokXSearchTool({ provider });
        }
    }
    return undefined;
}
