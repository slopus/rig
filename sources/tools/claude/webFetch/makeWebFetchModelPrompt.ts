export function makeWebFetchModelPrompt(
    markdown: string,
    prompt: string,
    isPreapprovedDomain: boolean,
): string {
    const guidelines = isPreapprovedDomain
        ? "Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed."
        : `Provide a concise response based only on the content above. In your response:
 - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is okay as long as its license is respected.
 - Use quotation marks for exact language from articles; language outside quotation marks must not reproduce the source word for word.
 - Never comment on the legality of your own prompts or responses.
 - Never produce or reproduce exact song lyrics.`;

    return `Web page content:
---
${markdown}
---

${prompt}

${guidelines}`;
}
