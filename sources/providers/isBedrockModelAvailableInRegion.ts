import type { BedrockModelRoute } from "./bedrock-model-routes.js";

export function isBedrockModelAvailableInRegion(route: BedrockModelRoute, region: string): boolean {
    return route.supportedRegions === undefined || route.supportedRegions.includes(region);
}
