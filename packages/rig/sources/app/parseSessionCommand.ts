export interface SessionCommandOptions {
    all: boolean;
    last: boolean;
    sessionId?: string;
}

export function parseSessionCommand(args: readonly string[]): SessionCommandOptions {
    const options: SessionCommandOptions = { all: false, last: false };
    for (const arg of args) {
        if (arg === "--all") {
            options.all = true;
        } else if (arg === "--last") {
            options.last = true;
        } else if (arg.startsWith("-")) {
            throw new Error(`Unknown session option '${arg}'.`);
        } else if (options.sessionId === undefined) {
            options.sessionId = arg;
        } else {
            throw new Error("Provide only one session identifier.");
        }
    }
    if (options.last && options.sessionId !== undefined) {
        throw new Error("Choose either --last or a session identifier, not both.");
    }
    return options;
}
