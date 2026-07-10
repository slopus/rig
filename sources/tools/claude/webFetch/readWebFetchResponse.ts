const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024;

export async function readWebFetchResponse(response: Response): Promise<Buffer> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_CONTENT_LENGTH) {
        throw new Error("Web response exceeds the 10 MB size limit");
    }
    if (response.body === null) {
        return Buffer.alloc(0);
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        totalBytes += value.byteLength;
        if (totalBytes > MAX_HTTP_CONTENT_LENGTH) {
            await reader.cancel();
            throw new Error("Web response exceeds the 10 MB size limit");
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks, totalBytes);
}
