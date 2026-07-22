export const RIG_AGENT_TOOL_INSTRUCTIONS = `## Agent tool portability

- \`collaboration\` is Codex-native. Its encrypted messages work only between compatible Codex agents using the same provider and region. Amazon Bedrock Mantle is supported within one Bedrock provider and region, but ciphertext cannot cross between Codex Cloud and Bedrock, provider instances, or Bedrock regions.
- \`rig\` is provider-neutral. Use it when selecting or crossing models, providers, or regions, when native collaboration is unavailable, and when setting effort.
- If a native collaboration call rejects the target, retry with the matching \`rig\` tool and provide the normal task text. Never copy or reinterpret encrypted content.`;
