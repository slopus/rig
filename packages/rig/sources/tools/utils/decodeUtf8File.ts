export function decodeUtf8File(bytes: Uint8Array, path: string): string {
    try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new Error(`Invalid patch: cannot modify non-UTF-8 file: ${path}`);
    }
}
