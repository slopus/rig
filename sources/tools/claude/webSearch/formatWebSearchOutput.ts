import type { WebSearchOutput } from "./types.js";

export function formatWebSearchOutput(output: WebSearchOutput): string {
    let formatted = `Web search results for query: "${output.query}"\n\n`;
    for (const result of output.results) {
        if (typeof result === "string") {
            formatted += `${result}\n\n`;
        } else if (result.content.length > 0) {
            formatted += `Links: ${JSON.stringify(result.content)}\n\n`;
        } else {
            formatted += "No links found.\n\n";
        }
    }
    formatted +=
        "\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.";
    return formatted.trim();
}
