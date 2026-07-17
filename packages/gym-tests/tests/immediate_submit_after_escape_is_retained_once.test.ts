import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("immediate submit after Escape", () => {
    it("retains one follow-up until abort settlement and sends it once", async () => {
        const immediate = "Retain this immediate post-Escape follow-up.";
        const later = "Confirm the session remains usable afterward.";
        const gym = await createGym({
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [{ text: "UNREACHABLE_ABORTED_RESPONSE", type: "text" }],
                        delayMs: 60_000,
                    };
                }
                const userTexts = request.context.messages.flatMap((message) =>
                    message.role === "user" ? [messageText(message.content)] : [],
                );
                expect(userTexts.filter((text) => text === immediate)).toHaveLength(1);
                if (callIndex === 1) {
                    return { content: [{ text: "IMMEDIATE_FOLLOWUP_DELIVERED", type: "text" }] };
                }
                expect(callIndex).toBe(2);
                expect(userTexts.filter((text) => text === later)).toHaveLength(1);
                return { content: [{ text: "POST_INTERRUPT_SESSION_USABLE", type: "text" }] };
            },
            rows: 38,
        });
        running.add(gym);

        submit(gym, "Start a response that will be interrupted.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);

        gym.terminal.write("\x1b");
        gym.terminal.type(immediate);
        gym.terminal.press("enter");

        const delivered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                snapshot.text.includes("IMMEDIATE_FOLLOWUP_DELIVERED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                !snapshot.text.includes("Messages to be submitted after next tool call") &&
                !snapshot.text.includes("There is no active run to steer") &&
                !snapshot.text.includes("409"),
            "the immediate submit to run exactly once after interrupt settlement",
            30_000,
        );
        expect(agentRequests(gym)).toHaveLength(2);
        expect(countOccurrences(delivered.text, immediate)).toBe(1);
        expect(await readSubmissionCounts(gym, immediate)).toEqual({
            eventCount: 1,
            messageCount: 1,
        });
        await screenshot(gym, "immediate-post-escape-submit-delivered.png");

        submit(gym, later);
        await gym.terminal.waitForText("POST_INTERRUPT_SESSION_USABLE", 30_000);
        expect(agentRequests(gym)).toHaveLength(3);
        expect(await readSubmissionCounts(gym, immediate)).toEqual({
            eventCount: 1,
            messageCount: 1,
        });
    }, 120_000);
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

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}

function countOccurrences(text: string, value: string): number {
    return text.split(value).length - 1;
}

async function readSubmissionCounts(
    gym: Gym,
    displayText: string,
): Promise<{ eventCount: number; messageCount: number }> {
    const script = `
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync("/home/rig/.rig/sessions.sqlite");
const session = database.prepare(
  "SELECT id FROM sessions WHERE parent_session_id IS NULL ORDER BY created_at_ms DESC LIMIT 1"
).get();
const events = database.prepare(
  "SELECT data_json FROM session_events WHERE session_id = ? AND type = 'message_submitted'"
).all(session.id).map((row) => JSON.parse(row.data_json));
const matching = events.filter((event) => event.displayText === ${JSON.stringify(displayText)});
const messageIds = matching.map((event) => event.message.id);
const messageCount = messageIds.length === 0 ? 0 : database.prepare(
  "SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ? AND message_id = ?"
).get(session.id, messageIds[0]).count;
database.close();
process.stdout.write(JSON.stringify({ eventCount: matching.length, messageCount }));
`;
    const result = await gym.runInContainer("node", ["-e", script]);
    expect(result.stderr).toBe("");
    return JSON.parse(result.stdout) as { eventCount: number; messageCount: number };
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}
