type TerminalQuery = "background" | "device-attributes" | "foreground";

const queries = [
    { bytes: [0x1b, 0x5d, 0x31, 0x30, 0x3b, 0x3f], query: "foreground" },
    { bytes: [0x1b, 0x5d, 0x31, 0x31, 0x3b, 0x3f], query: "background" },
    { bytes: [0x1b, 0x5b, 0x63], query: "device-attributes" },
] as const satisfies readonly { bytes: readonly number[]; query: TerminalQuery }[];

const maximumQueryLength = Math.max(...queries.map(({ bytes }) => bytes.length));

export class TerminalQueryTracker {
    #suffix: number[] = [];

    observe(data: Uint8Array): readonly TerminalQuery[] {
        const found: TerminalQuery[] = [];
        for (const byte of data) {
            this.#suffix.push(byte);
            const match = queries.find(({ bytes }) => endsWith(this.#suffix, bytes));
            if (match) {
                found.push(match.query);
                this.#suffix = [];
            } else if (this.#suffix.length >= maximumQueryLength) {
                this.#suffix.shift();
            }
        }
        return found;
    }
}

function endsWith(value: readonly number[], suffix: readonly number[]): boolean {
    if (value.length < suffix.length) return false;
    return suffix.every((byte, index) => value[value.length - suffix.length + index] === byte);
}
