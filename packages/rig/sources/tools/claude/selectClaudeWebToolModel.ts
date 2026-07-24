import type { Model, Provider } from "@slopus/rig-execution";

export function selectClaudeWebToolModel(provider: Provider, currentModel: Model): Model {
    const sonnet = provider.models.find(matchesFamily("sonnet"));
    if (sonnet !== undefined) return sonnet;
    const opus = provider.models.find(matchesFamily("opus"));
    if (opus !== undefined) return opus;
    const current = provider.models.find((candidate) => candidate.id === currentModel.id);
    if (current !== undefined) return current;
    throw new Error(
        `The selected provider '${provider.id}' does not allow Sonnet, Opus, or the current session model '${currentModel.name}'.`,
    );
}

function matchesFamily(family: "sonnet" | "opus"): (model: Model) => boolean {
    return (model) => `${model.id}\n${model.name}`.toLowerCase().includes(family);
}
