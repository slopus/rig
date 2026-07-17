const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeJsonPayload(value: unknown): Uint8Array {
    return encoder.encode(JSON.stringify(value));
}

export function decodeJsonPayload<T>(value: Uint8Array): T {
    return JSON.parse(decoder.decode(value)) as T;
}
