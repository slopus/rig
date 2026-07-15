import { truncateToWidth, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";

import type { DaemonRestartRequest } from "../client/index.js";
import { createSelectionPanel } from "./createSelectionPanel.js";
import { formatActivityElapsedTime } from "./formatActivityElapsedTime.js";
import { formatDaemonRestartMessage } from "./formatDaemonRestartMessage.js";
import { renderActivityWave } from "./renderActivityWave.js";
import { renderRigBanner } from "./renderRigBanner.js";
import { DEFAULT_TERMINAL_THEME } from "./defaultTerminalTheme.js";
import type { TerminalTheme } from "./TerminalTheme.js";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const ACTIVITY_ANIMATION_MS = 120;

export interface StartupStatusAppOptions {
    cwd: string;
    now?: () => number;
    tui: TUI;
    version: string;
    theme?: TerminalTheme;
}

export class StartupStatusApp implements Component, Focusable {
    readonly #now: () => number;
    readonly #tui: TUI;
    readonly #version: string;
    readonly #theme: TerminalTheme;

    focused = false;
    #activityAnimationFrame = 0;
    #selectionPanel: Component | undefined;
    #startedAtMs: number;
    #status = "Preparing local daemon.";
    #timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: StartupStatusAppOptions) {
        this.#now = options.now ?? Date.now;
        this.#startedAtMs = this.#now();
        this.#tui = options.tui;
        this.#version = options.version;
        this.#theme = options.theme ?? DEFAULT_TERMINAL_THEME;
    }

    invalidate(): void {}

    render(width: number): string[] {
        const safeWidth = Math.max(1, width);
        const lines = [
            "",
            ...renderRigBanner({
                brand: this.#theme.brand,
                secondary: this.#theme.secondary,
                version: this.#version,
                width: safeWidth,
            }),
            "",
            this.#renderStatusLine(safeWidth),
            "",
        ];
        if (this.#selectionPanel !== undefined) {
            lines.push(...this.#selectionPanel.render(safeWidth));
        }
        return lines;
    }

    confirmDaemonRestart(request: DaemonRestartRequest): Promise<boolean> {
        this.setStatus("Waiting for restart confirmation.");
        return new Promise((resolve) => {
            const finish = (restart: boolean) => {
                this.#selectionPanel = undefined;
                this.#tui.requestRender();
                resolve(restart);
            };
            this.#selectionPanel = createSelectionPanel({
                theme: this.#theme,
                items: [
                    {
                        description: "Stop the running daemon and continue with this CLI.",
                        label: "Restart daemon",
                        value: "restart",
                    },
                    {
                        description: "Leave the running daemon unchanged.",
                        label: "Exit Rig",
                        value: "exit",
                    },
                ],
                onCancel: () => finish(false),
                onSelect: (item) => finish(item.value === "restart"),
                subtitle: formatDaemonRestartMessage(request),
                title: "Restart local daemon?",
            });
            this.#tui.requestRender();
        });
    }

    handleInput(data: string): void {
        this.#selectionPanel?.handleInput?.(data === "\x03" ? "\x1b" : data);
        this.#tui.requestRender();
    }

    setStatus(status: string): void {
        this.#status = status;
        this.#tui.requestRender();
    }

    start(): void {
        this.#tui.addChild(this);
        this.#tui.setFocus(this);
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

    #renderStatusLine(width: number): string {
        const elapsed = formatActivityElapsedTime(this.#now() - this.#startedAtMs);
        const elapsedSuffix =
            elapsed === undefined ? "" : ` ${DIM}${this.#theme.secondary}(${elapsed})${RESET}`;
        return this.#fitLine(
            `${this.#theme.brand}•${RESET} ${renderActivityWave(this.#status, this.#activityAnimationFrame)}${elapsedSuffix}`,
            width,
        );
    }

    #fitLine(line: string, width: number): string {
        return truncateToWidth(line, width, "", true);
    }
}
