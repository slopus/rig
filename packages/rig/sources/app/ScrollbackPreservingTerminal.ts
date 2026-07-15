import { ProcessTerminal } from "@earendil-works/pi-tui";

import {
    createTerminalInputBurstHandler,
    type TerminalInputBurstHandler,
} from "./createTerminalInputBurstHandler.js";

const RESIZE_SETTLE_MS = 75;

export class ScrollbackPreservingTerminal extends ProcessTerminal {
    #inputBurstHandler: TerminalInputBurstHandler | undefined;
    #resizeTimer: NodeJS.Timeout | undefined;

    get resizePending(): boolean {
        return this.#resizeTimer !== undefined;
    }

    override start(onInput: (data: string) => void, onResize: () => void): void {
        this.#inputBurstHandler?.dispose();
        this.#inputBurstHandler = createTerminalInputBurstHandler(onInput);
        super.start(
            (data) => this.#inputBurstHandler?.handle(data),
            () => {
                if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
                this.#resizeTimer = setTimeout(() => {
                    this.#resizeTimer = undefined;
                    onResize();
                }, RESIZE_SETTLE_MS);
            },
        );
    }

    override stop(): void {
        if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
        this.#resizeTimer = undefined;
        this.#inputBurstHandler?.dispose();
        this.#inputBurstHandler = undefined;
        super.stop();
    }
}
