import { TUI, type Terminal } from "@earendil-works/pi-tui";

import { ScrollbackPreservingTerminal } from "./ScrollbackPreservingTerminal.js";

export class ScrollbackPreservingTUI extends TUI {
    #forceRenderAfterResize = false;

    constructor(terminal: Terminal, showHardwareCursor?: boolean) {
        super(terminal, showHardwareCursor);
    }

    override requestRender(force = false): void {
        if (this.terminal instanceof ScrollbackPreservingTerminal && this.terminal.resizePending) {
            this.#forceRenderAfterResize ||= force;
            return;
        }
        const shouldForce = force || this.#forceRenderAfterResize;
        this.#forceRenderAfterResize = false;
        super.requestRender(shouldForce);
    }
}
