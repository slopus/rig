import { createInterface } from "node:readline/promises";

import type { DaemonRestartRequest } from "../client/index.js";
import { formatDaemonRestartMessage } from "./formatDaemonRestartMessage.js";

export async function confirmDaemonRestartInTerminal(
    request: DaemonRestartRequest,
    streams: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {},
): Promise<boolean> {
    const input = streams.input ?? process.stdin;
    if ((input as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY !== true) {
        return false;
    }
    const output = streams.output ?? process.stdout;
    output.write(`${formatDaemonRestartMessage(request)}\n`);
    const readline = createInterface({ input, output });
    try {
        const answer = await readline.question("Restart local daemon? [Y/n] ");
        return answer.trim().length === 0 || /^y(?:es)?$/iu.test(answer.trim());
    } finally {
        readline.close();
    }
}
