import type { RemoteTerminalProcessFactory } from "./RemoteTerminalProcess.js";
import { RemoteTerminal } from "./RemoteTerminal.js";
import type { CreateRemoteTerminalRequest } from "./types.js";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_MAX_SCROLLBACK = 10_000;
const MAX_COLS = 500;
const MAX_ROWS = 200;
const MAX_SCROLLBACK = 100_000;
const MAX_TERMINALS = 32;

export class RemoteTerminalManager {
    readonly #cwd: string;
    readonly #processFactory: RemoteTerminalProcessFactory;
    readonly #resolveCwd: (root: string, requested: string | undefined) => string;
    readonly #terminals = new Map<string, RemoteTerminal>();

    constructor(options: {
        cwd: string;
        processFactory: RemoteTerminalProcessFactory;
        resolveCwd: (root: string, requested: string | undefined) => string;
    }) {
        this.#cwd = options.cwd;
        this.#processFactory = options.processFactory;
        this.#resolveCwd = options.resolveCwd;
    }

    async close(): Promise<void> {
        await Promise.all([...this.#terminals.values()].map((terminal) => terminal.dispose()));
        this.#terminals.clear();
    }

    async create(request: CreateRemoteTerminalRequest): Promise<RemoteTerminal> {
        if (request.command !== undefined && typeof request.command !== "string") {
            throw new Error("The terminal command must be text.");
        }
        if (request.cwd !== undefined && typeof request.cwd !== "string") {
            throw new Error("The terminal working directory must be text.");
        }
        if (request.shell !== undefined && typeof request.shell !== "string") {
            throw new Error("The terminal shell must be text.");
        }
        const cols = boundedInteger(request.cols, DEFAULT_COLS, 1, MAX_COLS, "column count");
        const rows = boundedInteger(request.rows, DEFAULT_ROWS, 1, MAX_ROWS, "row count");
        const maxScrollback = boundedInteger(
            request.maxScrollback,
            DEFAULT_MAX_SCROLLBACK,
            0,
            MAX_SCROLLBACK,
            "scrollback row count",
        );
        if (this.#terminals.size >= MAX_TERMINALS) {
            const exited = [...this.#terminals.values()].find(
                (terminal) => terminal.summary().status === "exited",
            );
            if (exited === undefined)
                throw new Error("This session already has too many terminals.");
            this.#terminals.delete(exited.id);
            await exited.dispose();
        }
        const cwd = this.#resolveCwd(this.#cwd, request.cwd);
        const processOptions = {
            cols,
            cwd,
            rows,
            ...(request.command === undefined ? {} : { command: request.command }),
            ...(request.shell === undefined ? {} : { shell: request.shell }),
        };
        const terminal = await RemoteTerminal.create({
            cols,
            maxScrollback,
            processFactory: this.#processFactory,
            processOptions,
            rows,
        });
        this.#terminals.set(terminal.id, terminal);
        return terminal;
    }

    get(terminalId: string): RemoteTerminal | undefined {
        return this.#terminals.get(terminalId);
    }

    list(): readonly RemoteTerminal[] {
        return [...this.#terminals.values()];
    }
}

function boundedInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
    description: string,
): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`The terminal ${description} must be between ${minimum} and ${maximum}.`);
    }
    return value;
}
