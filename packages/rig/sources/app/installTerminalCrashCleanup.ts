export interface TerminalCrashCleanup {
    restore(): void;
    uninstall(): void;
}

export interface TerminalCrashCleanupProcessEvents {
    off(
        event: "uncaughtExceptionMonitor",
        listener: (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void,
    ): void;
    on(
        event: "uncaughtExceptionMonitor",
        listener: (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void,
    ): void;
}

export function installTerminalCrashCleanup(options: {
    processEvents?: TerminalCrashCleanupProcessEvents;
    terminal: {
        stop(): void;
        write(data: string): void;
    };
    tui: {
        stop(): void;
    };
}): TerminalCrashCleanup {
    const processEvents = options.processEvents ?? process;
    let restored = false;
    let installed = true;

    const restore = (): void => {
        if (restored) return;
        restored = true;

        try {
            options.terminal.write("\x1b[?2026l\x1b[?1004l\x1b[?1049l");
        } catch {
            // Continue through every independent best-effort restoration step.
        }

        let tuiStopped = false;
        try {
            options.tui.stop();
            tuiStopped = true;
        } catch {
            // Fall back to the terminal's lower-level raw-mode cleanup.
        }
        if (!tuiStopped) {
            try {
                options.terminal.stop();
            } catch {
                // The original fatal error must remain the process failure.
            }
        }

        try {
            options.terminal.write("\x1b[?2031l\x1b[0m\x1b[?25h\r\n");
        } catch {
            // The original fatal error must remain the process failure.
        }
    };
    const onUncaughtException = (): void => {
        restore();
    };

    processEvents.on("uncaughtExceptionMonitor", onUncaughtException);

    return {
        restore,
        uninstall: () => {
            if (!installed) return;
            installed = false;
            processEvents.off("uncaughtExceptionMonitor", onUncaughtException);
        },
    };
}
