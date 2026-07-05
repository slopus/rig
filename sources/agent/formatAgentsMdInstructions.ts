export function formatAgentsMdInstructions(cwd: string, text: string): string {
  return `# AGENTS.md instructions for ${cwd}

<INSTRUCTIONS>
${text}
</INSTRUCTIONS>`;
}
