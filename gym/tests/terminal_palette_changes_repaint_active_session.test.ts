import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
    createGym,
    type Gym,
    type TerminalCellSnapshot,
    type TerminalColorScheme,
    type TerminalSnapshot,
} from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();
const prompt = "Keep this turn active while the terminal palette changes.";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("terminal palette changes during an active session", () => {
    it("repaints retained text and the composer from light to dark and back to light", async () => {
        const gym = await createGym({
            inference: [
                {
                    content: [{ text: "Palette transition complete.", type: "text" }],
                    delayMs: 30_000,
                },
            ],
            terminalColorScheme: "light",
        });
        running.add(gym);

        gym.terminal.type(prompt);
        gym.terminal.press("enter");
        await gym.terminal.waitForText(prompt);

        const dark = await transition(gym, "dark", 235);
        await captureProof(gym, dark, "dark");

        const light = await transition(gym, "light", 254);
        await captureProof(gym, light, "light");

        expect(surfaceBackgrounds(dark, prompt)).toEqual([235]);
        expect(surfaceBackgrounds(dark, "Ask Rig to do anything")).toEqual([235]);
        expect(surfaceBackgrounds(light, prompt)).toEqual([254]);
        expect(surfaceBackgrounds(light, "Ask Rig to do anything")).toEqual([254]);
        expect(dark.scroll.atBottom).toBe(true);
        expect(light.scroll.atBottom).toBe(true);
    });
});

async function transition(
    gym: Gym,
    colorScheme: TerminalColorScheme,
    expectedBackground: number,
): Promise<TerminalSnapshot> {
    gym.terminal.setColorScheme(colorScheme);
    return gym.terminal
        .waitUntil(
            (snapshot) =>
                surfaceBackgrounds(snapshot, prompt).includes(expectedBackground) &&
                surfaceBackgrounds(snapshot, "Ask Rig to do anything").includes(expectedBackground),
            `${colorScheme} palette repaint`,
            2_000,
        )
        .catch(() => gym.terminal.snapshot());
}

function surfaceBackgrounds(snapshot: TerminalSnapshot, text: string): number[] {
    const row = snapshot.rows.findIndex((line) => line.includes(text));
    if (row < 0) return [];
    const backgrounds = cellsOnRow(snapshot, row)
        .map((cell) => cell.background)
        .filter(
            (background): background is { kind: "palette"; index: number } =>
                background?.kind === "palette",
        )
        .map((background) => background.index)
        .filter((index) => index !== 244);
    return [...new Set(backgrounds)];
}

function cellsOnRow(snapshot: TerminalSnapshot, row: number): TerminalCellSnapshot[] {
    return snapshot.cells.filter((cell) => cell.y === row);
}

async function captureProof(
    gym: Gym,
    snapshot: TerminalSnapshot,
    colorScheme: TerminalColorScheme,
): Promise<void> {
    const directory = process.env.RIG_LIVE_THEME_PROOF_DIR;
    const label = process.env.RIG_LIVE_THEME_PROOF_LABEL;
    if (directory === undefined || label === undefined) return;
    const light = colorScheme === "light";
    await gym.terminal.screenshot(resolve(directory, `${label}-${colorScheme}.png`), {
        background: light ? "#eeeeee" : "#0d0d0d",
        foreground: light ? "#0d0d0d" : "#eeeeee",
    });
    expect(snapshot.rows).toHaveLength(32);
}
