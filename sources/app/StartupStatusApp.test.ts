import { type TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { StartupStatusApp } from "./StartupStatusApp.js";

describe("StartupStatusApp", () => {
    it("renders the loading card without model details", () => {
        const tui = fakeTui();
        const app = new StartupStatusApp({
            cwd: "/workspace",
            now: () => 1_000,
            tui,
            version: "1.2.3",
        });

        const rendered = stripAnsi(app.render(80).join("\n"));
        expect(rendered).toContain(">_ Rig 1.2.3");
        expect(rendered).toContain("Agentic coding CLI for local project work.");
        expect(rendered).toContain("Keeps sessions in a private local daemon.");
        expect(rendered).toContain("Directory: workspace");
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
        expect(tui.start).toHaveBeenCalled();
        expect(tui.removeChild).toHaveBeenCalledWith(app);
        expect(tui.requestRender).toHaveBeenCalled();
        expect(tui.requestRender).not.toHaveBeenCalledWith(true);
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
