export type HappyIntegrationMode = "disabled" | "enabled";

export async function loadHappyIntegration(mode: HappyIntegrationMode = "disabled") {
    return mode === "enabled" ? import("../happy/index.js") : undefined;
}
