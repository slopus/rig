import { ensureLocalProtocolServer } from "../client/index.js";
import { confirmDaemonRestartInTerminal } from "./confirmDaemonRestartInTerminal.js";
import { selectSession } from "./selectSession.js";
import type { SessionCommandOptions } from "./parseSessionCommand.js";

export async function resolveSessionCommand(options: {
    command: "fork" | "resume";
    cwd: string;
    selection: SessionCommandOptions;
}): Promise<string> {
    const connection = await ensureLocalProtocolServer({
        confirmRestart: confirmDaemonRestartInTerminal,
        onStatus: (message) => process.stderr.write(`${message}\n`),
    });
    let sessionId = options.selection.sessionId;
    if (sessionId === undefined) {
        const listed = await connection.client.listSessions();
        const sessions = options.selection.all
            ? listed.sessions
            : listed.sessions.filter((session) => session.cwd === options.cwd);
        if (sessions.length === 0) {
            throw new Error(
                options.selection.all
                    ? "No saved sessions were found."
                    : "No saved sessions were found for the current directory. Use --all to include other directories.",
            );
        }
        if (options.selection.last) {
            sessionId = sessions[0]?.id;
            if (sessionId === undefined) throw new Error("No saved sessions were found.");
        } else {
            sessionId = await selectSession(sessions);
        }
    }

    if (options.command === "resume") return sessionId;
    const forked = await connection.client.forkSession(sessionId);
    return forked.session.id;
}
