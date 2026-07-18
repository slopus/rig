export class TitleTracker {
    readonly #decoder = new TextDecoder();
    #pending = "";
    #title = "";

    get title(): string {
        return this.#title;
    }

    observe(data: Uint8Array): void {
        this.#pending = `${this.#pending}${this.#decoder.decode(data, { stream: true })}`.slice(
            -16_384,
        );
        const escape = String.fromCharCode(0x1b);
        const bell = String.fromCharCode(0x07);
        let cursor = 0;
        let incompleteStart = -1;

        while (cursor < this.#pending.length) {
            const start = this.#pending.indexOf(`${escape}]`, cursor);
            if (start < 0) break;
            const separator = this.#pending.indexOf(";", start + 2);
            if (separator < 0) {
                incompleteStart = start;
                break;
            }

            const bellEnd = this.#pending.indexOf(bell, separator + 1);
            const stringEnd = this.#pending.indexOf(`${escape}\\`, separator + 1);
            const end =
                bellEnd < 0 ? stringEnd : stringEnd < 0 ? bellEnd : Math.min(bellEnd, stringEnd);
            if (end < 0) {
                incompleteStart = start;
                break;
            }

            const command = this.#pending.slice(start + 2, separator);
            if (command === "0" || command === "2") {
                this.#title = this.#pending.slice(separator + 1, end);
            }
            cursor = end + (end === stringEnd ? 2 : 1);
        }

        this.#pending =
            incompleteStart >= 0
                ? this.#pending.slice(incompleteStart)
                : this.#pending.endsWith(escape)
                  ? escape
                  : "";
    }
}
