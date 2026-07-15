import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { StartupStatusApp } from "./StartupStatusApp.js";

describe("StartupStatusApp", () => {
    it("renders the logo and version without model details", () => {
        const tui = fakeTui();
        const app = new StartupStatusApp({
            cwd: "/workspace",
            now: () => 1_000,
            tui,
            version: "1.2.3",
        });

        const lines = app.render(80);
        const rendered = stripAnsi(lines.join("\n"));
        expect(lines[0]).toBe("");
        expect(rendered).toContain("  ██████╗ ██╗ ██████╗    ██╗   ██████╗    ██████╗  ");
        expect(rendered).toContain("  ╚═╝  ╚═╝╚═╝ ╚═════╝    ╚═╝╚═╝╚══════╝╚═╝╚═════╝  ");
        expect(rendered).not.toContain("Agentic coding CLI");
        expect(rendered).not.toContain("private local daemon");
        expect(rendered).not.toContain("Directory:");
        expect(rendered).toContain("Preparing local daemon.");
        expect(rendered).not.toContain("Model:");
        expect(rendered).not.toContain("Provider:");
    });

    it("updates the status line and requests a render", () => {
        const tui = fakeTui();
        let now = 1_000;
        const app = new StartupStatusApp({
            cwd: "/workspace",
            now: () => now,
            tui,
            version: "1.2.3",
        });

        app.setStatus("Checking providers.");
        now = 3_300;

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain("Checking providers.");
        expect(rendered).toContain("(2s)");
        expect(tui.requestRender).toHaveBeenCalled();
    });

    it("keeps every rendered row within a tiny terminal width", () => {
        const app = new StartupStatusApp({
            cwd: "/workspace",
            tui: fakeTui(),
            version: "1.2.3",
        });

        const lines = app.render(12);

        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(12);
    });

    it("attaches to and detaches from the tui", () => {
        const tui = fakeTui();
        const app = new StartupStatusApp({
            cwd: "/workspace",
            tui,
            version: "1.2.3",
        });

        app.start();
        app.stop();

        expect(tui.addChild).toHaveBeenCalledWith(app);
        expect(tui.setFocus).toHaveBeenCalledWith(app);
        expect(tui.start).toHaveBeenCalled();
        expect(tui.removeChild).toHaveBeenCalledWith(app);
        expect(tui.requestRender).toHaveBeenCalled();
        expect(tui.requestRender).not.toHaveBeenCalledWith(true);
    });

    it("asks before restarting a daemon from another production version", async () => {
        const app = new StartupStatusApp({
            cwd: "/workspace",
            tui: fakeTui(),
            version: "1.3.0",
        });
        const confirmation = app.confirmDaemonRestart({
            currentIdentity: { version: "1.3.0" },
            runningIdentity: { version: "1.2.0" },
        });

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain("Restart local daemon?");
        expect(rendered).toContain("The running daemon uses Rig 1.2.0");
        expect(rendered).toContain("this CLI is Rig 1.3.0");
        expect(rendered).toContain("Restart daemon");
        expect(rendered).toContain("Exit Rig");

        app.handleInput("\r");

        await expect(confirmation).resolves.toBe(true);
    });
});

function fakeTui(): TUI {
    return {
        addChild: vi.fn(),
        removeChild: vi.fn(),
        requestRender: vi.fn(),
        setFocus: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        terminal: {
            columns: 80,
            rows: 20,
        },
    } as unknown as TUI;
}

function stripAnsi(value: string): string {
    let result = "";
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== "\u001b") {
            result += value[index];
            continue;
        }

        while (index < value.length && value[index] !== "m") {
            index += 1;
        }
    }
    return result;
}
