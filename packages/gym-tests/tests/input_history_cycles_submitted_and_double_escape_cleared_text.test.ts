import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("local composer input history", () => {
    it("cycles submitted messages and double-Escape-cleared drafts in recency order", async () => {
        const submittedFirst = "First submitted message.";
        const clearedFirst = "First cleared draft.";
        const submittedSecond = "Second submitted message.";
        const clearedSecond = "Second cleared draft.";
        const editedPrefix = "Edited and resubmitted: ";
        const gym = await createGym({
            inference: [
                { content: [{ text: "FIRST_COMPLETE", type: "text" }] },
                { content: [{ text: "SECOND_COMPLETE", type: "text" }] },
                { content: [{ text: "EDITED_COMPLETE", type: "text" }] },
            ],
        });
        running.add(gym);

        submit(gym, submittedFirst);
        await gym.terminal.waitForText("FIRST_COMPLETE", 30_000);
        await clearDraft(gym, clearedFirst);

        submit(gym, submittedSecond);
        await gym.terminal.waitForText("SECOND_COMPLETE", 30_000);
        await clearDraft(gym, clearedSecond);

        for (const expected of [clearedSecond, submittedSecond, clearedFirst, submittedFirst]) {
            gym.terminal.press("up");
            await waitForComposer(gym, expected);
        }
        for (const expected of [clearedFirst, submittedSecond, clearedSecond]) {
            gym.terminal.press("down");
            await waitForComposer(gym, expected);
        }
        gym.terminal.press("down");
        await waitForComposer(gym, "Ask Rig to do anything");

        gym.terminal.press("up");
        await waitForComposer(gym, clearedSecond);
        gym.terminal.type(editedPrefix);
        await waitForComposer(gym, `${editedPrefix}${clearedSecond}`);
        await screenshot(gym, "revised-history-retrieved-and-edited.png");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("EDITED_COMPLETE", 30_000);

        expect(lastUserText(agentRequests(gym).at(-1)?.context.messages ?? [])).toBe(
            `${editedPrefix}${clearedSecond}`,
        );
    }, 90_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

async function clearDraft(gym: Gym, text: string): Promise<void> {
    gym.terminal.type(text);
    await waitForComposer(gym, text);
    gym.terminal.press("escape");
    gym.terminal.press("escape");
    await waitForComposer(gym, "Ask Rig to do anything");
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

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function lastUserText(messages: readonly { role: string; content: unknown }[]): string | undefined {
    const message = [...messages].reverse().find((candidate) => candidate.role === "user");
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return undefined;
    return message.content
        .flatMap((block) =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string"
                ? [block.text]
                : [],
        )
        .join("");
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}
