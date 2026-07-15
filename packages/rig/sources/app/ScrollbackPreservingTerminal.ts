import { ProcessTerminal } from "@earendil-works/pi-tui";

import {
    createTerminalInputBurstHandler,
    type TerminalInputBurstHandler,
} from "./createTerminalInputBurstHandler.js";
import { TerminalOutputTrace } from "./TerminalOutputTrace.js";

const RESIZE_SETTLE_MS = 75;

export class ScrollbackPreservingTerminal extends ProcessTerminal {
    #inputBurstHandler: TerminalInputBurstHandler | undefined;
    #resizeTimer: NodeJS.Timeout | undefined;
    readonly #trace = new TerminalOutputTrace();

    get resizePending(): boolean {
        return this.#resizeTimer !== undefined;
    }

    override start(onInput: (data: string) => void, onResize: () => void): void {
        this.#inputBurstHandler?.dispose();
        this.#inputBurstHandler = createTerminalInputBurstHandler(onInput);
        super.start(
            (data) => {
                this.#trace.recordInput(data, this.#dimensions());
                this.#inputBurstHandler?.handle(data);
            },
            () => {
                this.#trace.recordResize("signal", this.#dimensions());
                if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
                this.#resizeTimer = setTimeout(() => {
                    this.#resizeTimer = undefined;
                    this.#trace.recordResize("settled", this.#dimensions());
                    onResize();
                }, RESIZE_SETTLE_MS);
                onResize();
            },
        );
    }

    override write(data: string): void {
        this.#trace.recordOutput(data, this.#dimensions());
        super.write(data);
    }

    override stop(): void {
        if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
        this.#resizeTimer = undefined;
        this.#inputBurstHandler?.dispose();
        this.#inputBurstHandler = undefined;
        super.stop();
    }

    #dimensions(): { columns: number; rows: number } {
        return { columns: this.columns, rows: this.rows };
    }
}
