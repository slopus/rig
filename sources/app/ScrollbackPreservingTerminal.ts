import { ProcessTerminal } from "@earendil-works/pi-tui";

const CLEAR_SCROLLBACK = "\x1b[3J";

export class ScrollbackPreservingTerminal extends ProcessTerminal {
    override write(data: string): void {
        super.write(data.replaceAll(CLEAR_SCROLLBACK, ""));
    }
}
