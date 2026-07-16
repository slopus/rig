const TRUNCATION_NOTICE = "... (directory listing truncated)";

export function boundDirectoryListing(
    entries: readonly string[],
    totalEntries: number,
    maxBytes: number,
): { entries: readonly string[]; text: string; truncated: boolean } {
    const output = [...entries];
    const completeText = output.join("\n");
    let outputBytes = Buffer.byteLength(completeText, "utf8");
    const truncated = totalEntries > output.length || outputBytes > maxBytes;
    if (!truncated) return { entries: output, text: completeText, truncated: false };

    const noticeBytes = Buffer.byteLength(TRUNCATION_NOTICE, "utf8");
    while (output.length > 0) {
        if (outputBytes + 1 + noticeBytes <= maxBytes) break;
        const removed = output.pop();
        if (removed === undefined) break;
        outputBytes -= Buffer.byteLength(removed, "utf8") + (output.length > 0 ? 1 : 0);
    }
    return {
        entries: output,
        text:
            output.length === 0 ? TRUNCATION_NOTICE : `${output.join("\n")}\n${TRUNCATION_NOTICE}`,
        truncated: true,
    };
}
