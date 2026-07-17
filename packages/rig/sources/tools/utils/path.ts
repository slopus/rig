export function splitLines(content: string): string[] {
    if (content.length === 0) {
        return [];
    }
    return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
