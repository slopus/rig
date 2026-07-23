import type { Model, ProviderImageProfile } from "@slopus/rig-execution";

export function resolveModelImageProfile(model: Model): ProviderImageProfile {
    return model.id.startsWith("anthropic/") ? "claude" : "codex";
}
