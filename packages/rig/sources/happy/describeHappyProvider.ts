import type { HappyProviderDescriptor } from "./types.js";

export function describeHappyProvider(providerId: string): HappyProviderDescriptor {
    const known: Readonly<Record<string, Omit<HappyProviderDescriptor, "id">>> = {
        claude: { kind: "claude", name: "Anthropic Claude" },
        codex: { kind: "codex", name: "OpenAI Codex" },
        grok: { kind: "grok", name: "xAI Grok" },
    };
    return {
        id: providerId,
        ...(known[providerId] ?? {
            kind: "custom",
            name: providerId
                .replaceAll(/[_-]+/gu, " ")
                .replaceAll(/\b\w/gu, (character) => character.toUpperCase()),
        }),
    };
}
