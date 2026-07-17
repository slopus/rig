import type { IncomingMessage, ServerResponse } from "node:http";

import type { RemoteTerminal, RemoteTerminalFrame } from "../terminal/index.js";
import { sendJson } from "./sendJson.js";

export function streamRemoteTerminalFrames(
    request: IncomingMessage,
    response: ServerResponse,
    terminal: RemoteTerminal,
    afterParameter: string | null,
): void {
    const header = request.headers["last-event-id"];
    const headerCursor = Array.isArray(header) ? header.at(-1) : header;
    const cursorText = headerCursor ?? afterParameter ?? undefined;
    const after = cursorText === undefined ? undefined : parseRevision(cursorText);
    if (cursorText !== undefined && after === undefined) {
        sendJson(response, 400, { error: "The terminal revision must be a whole number." });
        return;
    }
    const catchup = terminal.framesSince(after);
    if (catchup === undefined) {
        sendJson(response, 409, { error: "The terminal revision is no longer available." });
        return;
    }

    response.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
    });
    response.write(": connected\n\n");

    let waitingForDrain = false;
    let pending: RemoteTerminalFrame | undefined;
    const write = (frame: RemoteTerminalFrame) => {
        if (waitingForDrain) {
            pending = frame;
            return;
        }
        waitingForDrain = !response.write(formatFrame(frame));
    };
    const drain = () => {
        waitingForDrain = false;
        const frame = pending;
        pending = undefined;
        if (frame !== undefined) write(frame);
        if (terminal.frame().status === "exited" && !waitingForDrain) response.end();
    };
    response.on("drain", drain);
    const latest =
        catchup.at(-1) ?? (terminal.frame().status === "exited" ? terminal.frame() : undefined);
    if (latest !== undefined) write(latest);

    if (terminal.frame().status === "exited") {
        response.end();
        return;
    }

    const unsubscribe = terminal.subscribe((frame) => {
        write(frame);
        if (frame.status === "exited" && !waitingForDrain) response.end();
    });
    const heartbeat = setInterval(() => {
        if (!waitingForDrain) waitingForDrain = !response.write(": keepalive\n\n");
    }, 15_000);
    heartbeat.unref();
    request.once("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        response.off("drain", drain);
        response.end();
    });
}

function formatFrame(frame: RemoteTerminalFrame): string {
    return `id: ${frame.revision}\nevent: frame\ndata: ${JSON.stringify(frame)}\n\n`;
}

function parseRevision(value: string): number | undefined {
    if (!/^\d+$/.test(value)) return undefined;
    const revision = Number(value);
    return Number.isSafeInteger(revision) ? revision : undefined;
}
