import { createInterface } from "node:readline/promises";

import type { SessionSummary } from "../protocol/index.js";

export async function selectSession(
    sessions: readonly SessionSummary[],
    streams: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {},
): Promise<string> {
    if (sessions.length === 0) {
        throw new Error("No saved sessions were found.");
    }
    const input = streams.input ?? process.stdin;
    if ((input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY !== true) {
        throw new Error("Choose a session ID or use --last when input is not interactive.");
    }

    const output = streams.output ?? process.stdout;
    output.write("Saved sessions:\n\n");
    sessions.slice(0, 20).forEach((session, index) => {
        const title = session.title ?? "Untitled session";
        const date = new Date(session.lastMessageAt ?? session.updatedAt).toLocaleString();
        output.write(`${index + 1}. ${title}\n   ${session.cwd} · ${date}\n`);
    });
    const readline = createInterface({
        input,
        output,
    });
    try {
        const answer = await readline.question(
            `\nChoose a session [1-${Math.min(20, sessions.length)}]: `,
        );
        const selection = Number(answer.trim());
        const maxSelection = Math.min(20, sessions.length);
        const selected = sessions[selection - 1];
        if (
            !Number.isInteger(selection) ||
            selection < 1 ||
            selection > maxSelection ||
            selected === undefined
        ) {
            throw new Error("The selected session number is not valid.");
        }
        return selected.id;
    } finally {
        readline.close();
    }
}
