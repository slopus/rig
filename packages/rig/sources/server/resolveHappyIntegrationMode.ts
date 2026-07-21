import type { HappyIntegrationMode } from "./loadHappyIntegration.js";

export function resolveHappyIntegrationMode(
    hostMode: HappyIntegrationMode | undefined,
    configured: boolean,
): HappyIntegrationMode {
    return hostMode === "enabled" && configured ? "enabled" : "disabled";
}
