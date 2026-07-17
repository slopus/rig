import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("single Escape without pending steering", () => {
    it("stops the active interaction without clearing the composer draft", async () => {
        const draft = "Keep this unsent draft.";
        const gym = await createGym({
            inference: [
                {
                    content: [{ text: "UNREACHABLE_DELAYED_RESPONSE", type: "text" }],
                    delayMs: 60_000,
                },
            ],
        });
        running.add(gym);

        submit(gym, "Start a response that I will stop.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);
        gym.terminal.type(draft);
        await waitForComposer(gym, draft);

        gym.terminal.press("escape");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                !snapshot.text.includes("esc to interrupt") &&
                composerText(snapshot) === draft,
            "one Escape stopping interaction while preserving its draft",
            30_000,
        );

        expect(agentRequests(gym)).toHaveLength(1);
        await screenshot(gym, "revised-single-escape-stopped.png");
    }, 90_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

async function waitForComposer(gym: Gym, text: string) {
    return gym.terminal.waitUntil(
        (snapshot) => composerText(snapshot) === text,
        `composer text ${JSON.stringify(text)}`,
        30_000,
    );
}

function composerText(snapshot: { rows: readonly string[] }): string | undefined {
    const footer = snapshot.rows.findIndex((row) => row.includes("gym off · /workspace"));
    const row = footer >= 2 ? snapshot.rows[footer - 2] : undefined;
    return row?.replace(/^\s*›\s?/u, "").trimEnd();
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}
