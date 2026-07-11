import { ProcessTerminal } from "@earendil-works/pi-tui";

import {
    createTerminalInputBurstHandler,
    type TerminalInputBurstHandler,
} from "./createTerminalInputBurstHandler.js";

const CLEAR_SCROLLBACK = "\x1b[3J";

export class ScrollbackPreservingTerminal extends ProcessTerminal {
    #inputBurstHandler: TerminalInputBurstHandler | undefined;

    override start(onInput: (data: string) => void, onResize: () => void): void {
        this.#inputBurstHandler?.dispose();
        this.#inputBurstHandler = createTerminalInputBurstHandler(onInput);
        super.start((data) => this.#inputBurstHandler?.handle(data), onResize);
    }

    override stop(): void {
        this.#inputBurstHandler?.dispose();
        this.#inputBurstHandler = undefined;
        super.stop();
    }

    override write(data: string): void {
        super.write(data.replaceAll(CLEAR_SCROLLBACK, ""));
    }
}
