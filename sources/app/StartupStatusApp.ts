import { basename } from "node:path";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";

import { formatActivityElapsedTime } from "./formatActivityElapsedTime.js";
import { renderActivityWave } from "./renderActivityWave.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NOT_BOLD_OR_DIM = "\x1b[22m";
const RIG_ORANGE = "\x1b[38;5;202m";
const SURFACE_MUTED_FG = "\x1b[38;5;245m";
const ACTIVITY_ANIMATION_MS = 120;

export interface StartupStatusAppOptions {
    cwd: string;
    now?: () => number;
    tui: TUI;
    version: string;
}

export class StartupStatusApp implements Component {
    readonly #cwd: string;
    readonly #now: () => number;
    readonly #tui: TUI;
    readonly #version: string;

    #activityAnimationFrame = 0;
    #startedAtMs: number;
    #status = "Preparing local daemon.";
    #timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: StartupStatusAppOptions) {
        this.#cwd = options.cwd;
        this.#now = options.now ?? Date.now;
        this.#startedAtMs = this.#now();
        this.#tui = options.tui;
        this.#version = options.version;
    }

    invalidate(): void {}

    render(width: number): string[] {
        const safeWidth = Math.max(20, width);
        return [
            ...this.#renderStartupBox(safeWidth, [
                `${RIG_ORANGE}>_${RESET} ${BOLD}Rig${NOT_BOLD_OR_DIM} ${this.#version}`,
                "Agentic coding CLI for local project work.",
                "Keeps sessions in a private local daemon.",
                `Directory: ${this.#directoryName()}`,
            ]),
            "",
            this.#renderStatusLine(safeWidth),
            "",
        ];
    }

    setStatus(status: string): void {
        this.#status = status;
        this.#tui.requestRender();
    }

    start(): void {
        this.#tui.addChild(this);
        this.#timer = setInterval(() => {
            this.#activityAnimationFrame = (this.#activityAnimationFrame + 1) % 12;
            this.#tui.requestRender();
        }, ACTIVITY_ANIMATION_MS);
        this.#timer.unref?.();
        this.#tui.start();
        this.#tui.requestRender();
    }

    stop(): void {
        if (this.#timer !== undefined) {
            clearInterval(this.#timer);
            this.#timer = undefined;
        }
        this.#tui.removeChild(this);
        this.#tui.requestRender();
    }

    #directoryName(): string {
        return basename(this.#cwd) || this.#cwd;
    }

    #renderStartupBox(width: number, rows: string[]): string[] {
        const maxInnerWidth = Math.max(1, width - 4);
        const contentWidth = rows
            .map((row) => visibleWidth(row))
            .reduce((maxWidth, rowWidth) => Math.max(maxWidth, rowWidth), 1);
        const innerWidth = Math.min(maxInnerWidth, contentWidth);
        const rule = "─".repeat(innerWidth + 2);
        const top = `╭${rule}╮`;
        const bottom = `╰${rule}╯`;
        return [
            this.#truncateLine(`${DIM}${top}${RESET}`, width),
            ...rows.map((row) => {
                const paddedText = this.#fitAndPadLine(row, innerWidth);
                return this.#truncateLine(
                    `${DIM}│ ${NOT_BOLD_OR_DIM}${paddedText}${DIM} │${RESET}`,
                    width,
                );
            }),
            this.#truncateLine(`${DIM}${bottom}${RESET}`, width),
        ];
    }

    #renderStatusLine(width: number): string {
        const elapsed = formatActivityElapsedTime(this.#now() - this.#startedAtMs);
        const elapsedSuffix =
            elapsed === undefined ? "" : ` ${DIM}${SURFACE_MUTED_FG}(${elapsed})${RESET}`;
        return this.#fitLine(
            `${RIG_ORANGE}•${RESET} ${renderActivityWave(this.#status, this.#activityAnimationFrame)}${elapsedSuffix}`,
            width,
        );
    }

    #fitAndPadLine(line: string, width: number): string {
        const fitted = this.#fitLine(line, width);
        return `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`;
    }

    #fitLine(line: string, width: number): string {
        return truncateToWidth(line, width, "", true);
    }

    #truncateLine(line: string, width: number): string {
        return truncateToWidth(line, width, "", false);
    }
}
