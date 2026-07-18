import { GhosttyTerminal } from "./GhosttyTerminal.js";
import type { GhosttyOptions, GhosttyWasmSource } from "./types.js";

export function createGhosttyTerminalFromWasm(
    source: GhosttyWasmSource,
    options?: GhosttyOptions,
): Promise<GhosttyTerminal> {
    return GhosttyTerminal.create(source, options);
}
