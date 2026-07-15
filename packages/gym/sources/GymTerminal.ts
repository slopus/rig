import type { IPty } from "@lydell/node-pty";

import { GhosttyTerminal } from "./GhosttyTerminal.js";
import { renderTerminalSnapshotPng } from "./renderTerminalSnapshotPng.js";
import type { TerminalColorScheme, TerminalScreenshotOptions, TerminalSnapshot } from "./types.js";

const KEYS = {
    backspace: "\x7f",
    ctrlC: "\x03",
    ctrlD: "\x04",
    down: "\x1b[B",
    enter: "\r",
    escape: "\x1b",
    left: "\x1b[D",
    right: "\x1b[C",
    tab: "\t",
    up: "\x1b[A",
} as const;

export type GymKey = keyof typeof KEYS;

export class GymTerminal {
    #ghostty: GhosttyTerminal;
    #inputRevision = 0;
    #pty: IPty;

    constructor(pty: IPty, ghostty: GhosttyTerminal) {
        this.#pty = pty;
        this.#ghostty = ghostty;
    }

    get inputRevision(): number {
        return this.#inputRevision;
    }

    press(key: GymKey): void {
        this.#inputRevision += 1;
        this.#pty.write(KEYS[key]);
    }

    paste(text: string): void {
        this.#inputRevision += 1;
        this.#pty.write(`\x1b[200~${text}\x1b[201~`);
    }

    resize(cols: number, rows: number): void {
        this.#pty.resize(cols, rows);
        this.#ghostty.resize(cols, rows);
    }

    scrollBy(rows: number): void {
        this.#ghostty.scrollBy(rows);
    }

    scrollToBottom(): void {
        this.#ghostty.scrollToBottom();
    }

    scrollToTop(): void {
        this.#ghostty.scrollToTop();
    }

    onOutput(handler: (data: string) => void): () => void {
        return this.#ghostty.onOutput(handler);
    }

    setColorScheme(colorScheme: TerminalColorScheme): void {
        this.#ghostty.setColorScheme(colorScheme);
    }

    snapshot(): Promise<TerminalSnapshot> {
        return this.#ghostty.snapshot();
    }

    async screenshot(outputPath: string, options?: TerminalScreenshotOptions): Promise<void> {
        await renderTerminalSnapshotPng(await this.snapshot(), outputPath, options);
    }

    type(text: string): void {
        this.#inputRevision += 1;
        this.#pty.write(text);
    }

    write(data: string): void {
        this.#inputRevision += 1;
        this.#pty.write(data);
    }

    async waitForText(text: string, timeoutMs = 10_000): Promise<TerminalSnapshot> {
        return this.waitUntil(
            (snapshot) => snapshot.text.includes(text),
            `terminal text ${JSON.stringify(text)}`,
            timeoutMs,
        );
    }

    async waitUntil(
        predicate: (snapshot: TerminalSnapshot) => boolean,
        description = "terminal condition",
        timeoutMs = 10_000,
    ): Promise<TerminalSnapshot> {
        const deadline = Date.now() + timeoutMs;
        let last = await this.snapshot();
        while (!predicate(last)) {
            if (Date.now() >= deadline) {
                throw new Error(
                    `Timed out waiting for ${description}. Last terminal snapshot:\n\n${last.text}`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
            last = await this.snapshot();
        }
        return last;
    }
}
