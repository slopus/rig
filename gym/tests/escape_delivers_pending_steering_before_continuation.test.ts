import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Escape with pending steering", () => {
    it("delivers every pending message once before the continued inference", async () => {
        const firstPending = "Preserve this first pending direction.";
        const secondPending = "Preserve this second pending direction.";
        const continuation = "Continue using both pending directions.";
        const gym = await createGym({
            cols: 100,
            inference: (_request, callIndex) => {
                if (callIndex === 0) {
                    return {
                        content: [{ text: "UNREACHABLE_DELAYED_RESPONSE", type: "text" }],
                        delayMs: 60_000,
                    };
                }

                expect(callIndex).toBe(1);
                return { content: [{ text: "CONTINUATION_COMPLETE", type: "text" }] };
            },
            rows: 36,
        });
        running.add(gym);

        submit(gym, "Begin inference and wait for my steering.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);

        submit(gym, firstPending);
        submit(gym, secondPending);
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Messages to be submitted after next tool call") &&
                snapshot.text.includes(`↳ ${firstPending}`) &&
                snapshot.text.includes(`↳ ${secondPending}`),
            "both pending steering messages",
            30_000,
        );
        await screenshot(gym, "before-escape.png");

        gym.terminal.press("escape");
        const interrupted = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                !snapshot.text.includes("esc to interrupt"),
            "Escape interruption with pending steering delivered",
            30_000,
        );
        await screenshot(gym, "after-interrupt.png");
        assertDeliveredExactlyOnce(interrupted, [firstPending, secondPending]);

        submit(gym, continuation);
        const completed = await gym.terminal.waitForText("CONTINUATION_COMPLETE", 30_000);
        await screenshot(gym, "completed-continuation.png");
        assertDeliveredExactlyOnce(completed, [firstPending, secondPending]);

        const requests = agentRequests(gym);
        expect(requests).toHaveLength(2);
        const continuedUserTexts = requests[1]?.context.messages.flatMap(userText) ?? [];
        expect(continuedUserTexts.filter((text) => text === firstPending)).toHaveLength(1);
        expect(continuedUserTexts.filter((text) => text === secondPending)).toHaveLength(1);
        expect(continuedUserTexts.filter((text) => text === continuation)).toHaveLength(1);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function assertDeliveredExactlyOnce(
    snapshot: { rows: readonly string[]; text: string },
    messages: readonly string[],
): void {
    expect(snapshot.text).not.toContain("Messages to be submitted after next tool call");
    expect(snapshot.text).not.toContain("(esc to send now)");
    for (const message of messages) {
        expect(snapshot.rows.filter((row) => row.trim() === `› ${message}`)).toHaveLength(1);
        expect(snapshot.text).not.toContain(`↳ ${message}`);
    }
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function userText(message: { role: string; content: unknown }): string[] {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    if (!Array.isArray(message.content)) return [];
    return message.content.flatMap((block) => {
        if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string"
        ) {
            return [block.text];
        }
        return [];
    });
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}
