export function truncateTextHead(
    value: string,
    options: { maxBytes: number; maxLines: number },
): {
    content: string;
    outputBytes: number;
    outputLines: number;
    totalBytes: number;
    totalLines: number;
    truncated: boolean;
} {
    const totalBytes = Buffer.byteLength(value, "utf8");
    const lines = value.length === 0 ? [] : value.split("\n");
    if (value.endsWith("\n")) lines.pop();
    const totalLines = lines.length;
    if (totalLines <= options.maxLines && totalBytes <= options.maxBytes) {
        return {
            content: value,
            outputBytes: totalBytes,
            outputLines: totalLines,
            totalBytes,
            totalLines,
            truncated: false,
        };
    }

    const output: string[] = [];
    let outputBytes = 0;
    for (const line of lines) {
        if (output.length >= options.maxLines) break;
        const separatorBytes = output.length === 0 ? 0 : 1;
        const lineBytes = Buffer.byteLength(line, "utf8") + separatorBytes;
        if (outputBytes + lineBytes <= options.maxBytes) {
            output.push(line);
            outputBytes += lineBytes;
            continue;
        }
        if (output.length === 0) {
            const buffer = Buffer.from(line, "utf8");
            let end = Math.min(buffer.length, options.maxBytes);
            while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end--;
            const head = buffer.subarray(0, end).toString("utf8");
            output.push(head);
        }
        break;
    }

    const content = output.join("\n");
    return {
        content,
        outputBytes: Buffer.byteLength(content, "utf8"),
        outputLines: output.length,
        totalBytes,
        totalLines,
        truncated: true,
    };
}
