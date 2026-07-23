export function trimIndent(value: string): string {
    const lines = value.split(/\r?\n/u);
    const contentLines = lines.filter((line) => line.trim().length > 0);
    if (contentLines.length === 0) return "";
    const minimumIndent = Math.min(...contentLines.map(indentWidth));
    const lastIndex = lines.length - 1;
    return lines
        .flatMap((line, index) =>
            (index === 0 || index === lastIndex) && line.trim().length === 0
                ? []
                : [line.trim().length === 0 ? "" : line.slice(minimumIndent)],
        )
        .join("\n");
}

function indentWidth(line: string): number {
    const contentStart = line.search(/\S/u);
    return contentStart === -1 ? line.length : contentStart;
}
