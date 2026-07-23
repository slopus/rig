import type { BashContext } from "../../../context/BashContext.js";

const INTERRUPT = "\u0003";

export async function sendShellSessionInput(
    bash: BashContext,
    sessionId: number,
    chars: string,
): Promise<void> {
    const chunks = chars.split(INTERRUPT);
    for (const [index, chunk] of chunks.entries()) {
        if (chunk.length > 0) {
            if (!bash.supportsSessionInput) {
                throw new Error("This shell session does not support interactive input.");
            }
            const written = await bash.writeSession(sessionId, chunk);
            if (!written) throw new Error("The shell session is no longer accepting input.");
        }
        if (index === chunks.length - 1) continue;
        if (bash.interruptSession === undefined) {
            throw new Error("This shell session does not support interrupts.");
        }
        const interrupted = await bash.interruptSession(sessionId);
        if (interrupted === undefined) throw new Error("The shell session was not found.");
        if (!interrupted) throw new Error("The shell session is no longer running.");
    }
}
