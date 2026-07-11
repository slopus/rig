import { afterEach, describe, expect, it, vi } from "vitest";

import { createTerminalInputBurstHandler } from "./createTerminalInputBurstHandler.js";

describe("createTerminalInputBurstHandler", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("coalesces a raw multiline Unicode write before forwarding Enter", () => {
        vi.useFakeTimers();
        const received: string[] = [];
        const handler = createTerminalInputBurstHandler((data) => received.push(data));
        const message = "first  line\n\t日本語 👩🏽‍💻 e\u0301\nlast line";

        for (const codeUnit of message.split("")) handler.handle(codeUnit);

        expect(received).toEqual([]);
        handler.handle("\r");
        expect(received).toEqual([message, "\r"]);
    });

    it("forwards ordinary typing after a short burst window", () => {
        vi.useFakeTimers();
        const received: string[] = [];
        const handler = createTerminalInputBurstHandler((data) => received.push(data));

        handler.handle("a");
        expect(received).toEqual([]);
        vi.advanceTimersByTime(8);

        expect(received).toEqual(["a"]);
    });

    it("flushes pending text before forwarding an escape sequence", () => {
        vi.useFakeTimers();
        const received: string[] = [];
        const handler = createTerminalInputBurstHandler((data) => received.push(data));

        handler.handle("text");
        handler.handle("\x1b[A");

        expect(received).toEqual(["text", "\x1b[A"]);
    });
});
