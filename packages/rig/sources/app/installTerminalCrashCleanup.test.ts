import { describe, expect, it, vi } from "vitest";

import { installTerminalCrashCleanup } from "./installTerminalCrashCleanup.js";

describe("installTerminalCrashCleanup", () => {
    it("restores terminal modes once without handling the fatal error", () => {
        const listeners = new Set<() => void>();
        const processEvents = {
            off: vi.fn((_event: "uncaughtExceptionMonitor", listener: () => void) => {
                listeners.delete(listener);
            }),
            on: vi.fn((_event: "uncaughtExceptionMonitor", listener: () => void) => {
                listeners.add(listener);
            }),
        };
        const terminal = {
            stop: vi.fn(),
            write: vi.fn(),
        };
        const tui = {
            stop: vi.fn(),
        };

        const cleanup = installTerminalCrashCleanup({ processEvents, terminal, tui });
        const [onFatalError] = listeners;
        expect(onFatalError).toBeDefined();

        onFatalError?.();
        cleanup.restore();

        expect(terminal.write.mock.calls.map(([value]) => value).join("")).toContain(
            "\x1b[?2026l\x1b[?1004l\x1b[?1049l",
        );
        expect(terminal.write.mock.calls.map(([value]) => value).join("")).toContain(
            "\x1b[0m\x1b[?25h",
        );
        expect(tui.stop).toHaveBeenCalledTimes(1);
        expect(terminal.stop).not.toHaveBeenCalled();

        cleanup.uninstall();
        cleanup.uninstall();
        expect(processEvents.off).toHaveBeenCalledTimes(1);
        expect(listeners).toHaveLength(0);
    });

    it("falls back to stopping the terminal and never replaces the original crash", () => {
        const listener = vi.fn();
        const processEvents = {
            off: vi.fn(),
            on: vi.fn((_event: "uncaughtExceptionMonitor", value: () => void) => {
                listener.mockImplementation(value);
            }),
        };
        const terminal = {
            stop: vi.fn(),
            write: vi
                .fn()
                .mockImplementationOnce(() => {
                    throw new Error("write failed");
                })
                .mockImplementationOnce(() => {
                    throw new Error("final write failed");
                }),
        };
        const tui = {
            stop: vi.fn(() => {
                throw new Error("TUI stop failed");
            }),
        };

        installTerminalCrashCleanup({ processEvents, terminal, tui });

        expect(() => listener()).not.toThrow();
        expect(tui.stop).toHaveBeenCalledTimes(1);
        expect(terminal.stop).toHaveBeenCalledTimes(1);
    });
});
