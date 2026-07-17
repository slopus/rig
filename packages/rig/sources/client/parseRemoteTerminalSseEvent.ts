import type { RemoteTerminalFrame } from "../terminal/index.js";

export function parseRemoteTerminalSseEvent(raw: string): RemoteTerminalFrame | undefined {
    if (raw.startsWith(":")) return undefined;
    const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart());
    if (data.length === 0) return undefined;
    const frame = JSON.parse(data.join("\n")) as RemoteTerminalFrame;
    return Number.isSafeInteger(frame.revision) ? frame : undefined;
}
