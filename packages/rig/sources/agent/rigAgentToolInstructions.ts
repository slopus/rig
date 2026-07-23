export const RIG_AGENT_TOOL_INSTRUCTIONS = `## Agent tool portability

- \`collaboration\` is Codex Cloud's encrypted v2 protocol. \`multi_agent_v1\` is the plaintext protocol used by Codex models on Amazon Bedrock.
- \`rig\` is provider-neutral. Use it when selecting or crossing models, providers, or regions, when native collaboration is unavailable, and when setting effort.
- If a native collaboration call rejects the target, retry with the matching \`rig\` tool and provide the normal task text. Never copy or reinterpret encrypted content.`;
