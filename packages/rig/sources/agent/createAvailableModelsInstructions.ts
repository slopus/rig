import type { AvailableSubagentModel } from "./context/SubagentContext.js";

export function createAvailableModelsInstructions(
    models: readonly AvailableSubagentModel[],
): string | undefined {
    if (models.length === 0) return undefined;

    return [
        "# Available models",
        "You can run subagents with any of these models by passing the provider and model ID exactly as shown:",
        ...models.map((model) => `- ${model.providerId}: ${model.name} (\`${model.id}\`)`),
        "",
        "A request that gives you only a bare model or family name—such as Codex, GPT, Opus, or Sonnet—usually means they want you to run that model somehow. When the request can be handled by a subagent, spawn a subagent with the closest available model and provider. This is usually safe to do without asking for confirmation.",
    ].join("\n");
}
