import { readFile } from "node:fs/promises";

export async function loadBundledWasm(): Promise<ArrayBuffer> {
    const bytes = await readFile(new URL("../wasm/ghostty-vt.wasm", import.meta.url));
    return Uint8Array.from(bytes).buffer;
}
