import { afterEach, describe, expect, it } from "vitest";

import {
    createGym,
    type Gym,
    type TerminalCellSnapshot,
    type TerminalSnapshot,
} from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("agent response colors", () => {
    it("uses Codex terminal colors for prose, inline code, and links", async () => {
        const gym = await createGym({
            inference: [
                {
                    content: [
                        {
                            text: "Plain agent prose with `inline code` and [docs](https://example.com).",
                            type: "text",
                        },
                    ],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Show colors.");
        gym.terminal.press("enter");

        const snapshot = await gym.terminal.waitForText("Plain agent prose");
        expect(stylesForText(snapshot, "Plain agent prose")).toEqual([
            expect.objectContaining({ foreground: null }),
        ]);
        expect(stylesForText(snapshot, "inline code")).toEqual([
            expect.objectContaining({ foreground: { kind: "palette", index: 6 } }),
        ]);
        expect(stylesForText(snapshot, "docs")).toEqual([
            expect.objectContaining({ foreground: { kind: "palette", index: 6 } }),
        ]);
    });

    it("uses Rig orange only for Ran and keeps the command in the normal foreground", async () => {
        const gym = await createGym({
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "printf command-orange-check" },
                            id: "orange-command",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "Command completed.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Run the color check.");
        gym.terminal.press("enter");

        const snapshot = await gym.terminal.waitForText("Command completed.", 30_000);
        expect(stylesForText(snapshot, "Ran")).toEqual([
            expect.objectContaining({ foreground: { kind: "palette", index: 202 } }),
        ]);
        expect(stylesForText(snapshot, "printf")).toEqual([
            expect.objectContaining({ foreground: { kind: "palette", index: 75 } }),
        ]);
        expect(stylesForText(snapshot, "command-orange-check")).toEqual([
            expect.objectContaining({ foreground: null }),
        ]);
    });

    it("loads semantic theme overrides from project config", async () => {
        const gym = await createGym({
            files: {
                "rig.toml": '[theme]\nprimary = "#123456"\n',
            },
            inference: [{ content: [{ text: "Configured primary text.", type: "text" }] }],
        });
        running.add(gym);

        gym.terminal.type("Show configured text.");
        gym.terminal.press("enter");

        const snapshot = await gym.terminal.waitForText("Configured primary text.");
        expect(stylesForText(snapshot, "Configured primary text.")).toEqual([
            expect.objectContaining({
                foreground: { kind: "rgb", red: 18, green: 52, blue: 86 },
            }),
        ]);
    });
});

function stylesForText(snapshot: TerminalSnapshot, text: string): TerminalCellSnapshot[] {
    for (const row of snapshot.rows.keys()) {
        const start = snapshot.rows[row]?.indexOf(text) ?? -1;
        if (start < 0) continue;
        const cells = snapshot.cells.filter(
            (cell) => cell.y === row && cell.x >= start && cell.x < start + text.length,
        );
        return cells.filter(
            (cell, index) =>
                index === 0 ||
                JSON.stringify(cell.foreground) !== JSON.stringify(cells[index - 1]?.foreground),
        );
    }
    throw new Error(`Could not find ${JSON.stringify(text)} in terminal snapshot.`);
}
