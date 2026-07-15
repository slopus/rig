import type { ConfigProvider } from "./types.js";

export function configuredProviderId(id: string, provider: ConfigProvider): string {
    return id === "claude" && provider.type === "claude" ? "claude-sdk" : id;
}
