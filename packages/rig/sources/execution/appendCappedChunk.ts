export function appendCappedChunk(
    chunks: Buffer[],
    currentBytes: number,
    chunk: Buffer,
    maximumBytes: number,
): number {
    if (maximumBytes <= 0) {
        chunks.length = 0;
        return 0;
    }
    chunks.push(chunk);
    let retainedBytes = currentBytes + chunk.length;
    let excessBytes = retainedBytes - maximumBytes;
    while (excessBytes > 0) {
        const first = chunks[0];
        if (first === undefined) return 0;
        if (first.length <= excessBytes) {
            chunks.shift();
            retainedBytes -= first.length;
            excessBytes -= first.length;
        } else {
            chunks[0] = first.subarray(excessBytes);
            retainedBytes -= excessBytes;
            excessBytes = 0;
        }
    }
    return retainedBytes;
}
