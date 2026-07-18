export async function loadBundledWasm(): Promise<ArrayBuffer> {
    const response = await fetch(new URL("../wasm/ghostty-vt.wasm", import.meta.url));
    if (!response.ok) {
        throw new Error(
            `Ghostty WASM could not be loaded: ${response.status} ${response.statusText}`,
        );
    }
    return response.arrayBuffer();
}
