import { createGhosttyTerminalFromWasm } from "./create-terminal.js";
import { loadBundledWasm } from "./load-bundled-wasm.browser.js";
import type { GhosttyLoadOptions } from "./types.js";

export { GhosttyTerminal } from "./GhosttyTerminal.js";
export { createGhosttyTerminalFromWasm } from "./create-terminal.js";
export type * from "./types.js";

export async function createGhosttyTerminal(options: GhosttyLoadOptions = {}) {
    const { loadWasm, ...terminalOptions } = options;
    const source = loadWasm ? await loadWasm() : await loadBundledWasm();
    return createGhosttyTerminalFromWasm(source, terminalOptions);
}
