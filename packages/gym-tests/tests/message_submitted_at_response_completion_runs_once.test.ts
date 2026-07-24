import { afterEach, describe, expect, it } from "vitest";

import { createGym, waitForFile, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("message submitted at response completion", () => {
    it("runs the message exactly once without exposing a stale steering error", async () => {
        const followUp = "Use the configured token.";
        const releaseFollowUp = deferred<void>();
        const gym = await createGym({
            async inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [{ text: "FIRST_RESPONSE_COMPLETE", type: "text" }],
                        textDeltaChunkSize: 1,
                    };
                }

                expect(callIndex).toBe(1);
                const matchingUserMessages = request.context.messages
                    .flatMap(userText)
                    .filter((text) => text === followUp);
                expect(matchingUserMessages).toEqual([followUp]);
                await releaseFollowUp.promise;
                return { content: [{ text: "FOLLOW_UP_COMPLETE", type: "text" }] };
            },
            environment: {
                RIG_GYM_SESSION_TERMINAL_EVENT_BARRIER: ".session-terminal-event-release",
            },
            rows: 36,
        });
        running.add(gym);

        submit(gym, "Finish the first response.");
        await gym.terminal.waitForText("FIRST_RESPONSE_COMPLETE", 30_000);
        await waitForFile(gym, ".session-terminal-event-release.ready", 30_000);
        await expect
            .poll(
                async () => (await gym.readFile(".session-terminal-event-release.ready")).length,
                { timeout: 30_000 },
            )
            .toBeGreaterThanOrEqual(2);
        submit(gym, followUp);

        await gym.terminal.waitUntil(
            () => agentRequests(gym).length === 2,
            "the daemon to start the follow-up run while terminal events are blocked",
            30_000,
        );
        const submissions = await readSubmissions(gym);
        expect(submissions).toHaveLength(2);
        expect(submissions[0]).toMatchObject({ delivery: "run" });
        expect(submissions[1]).toMatchObject({ delivery: "run", displayText: followUp });
        expect(submissions[1]?.runId).not.toBe(submissions[0]?.runId);

        await gym.runInContainer("touch", [".session-terminal-event-release"]);
        await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("esc to interrupt"),
            "the follow-up run to remain active after delayed terminal events arrive",
            30_000,
        );
        releaseFollowUp.resolve();
        const completed = await gym.terminal.waitForText("FOLLOW_UP_COMPLETE", 30_000);
        expect(completed.rows.filter((row) => row.trim() === `› ${followUp}`)).toHaveLength(1);
        expect(completed.text).not.toContain("There is no active run to steer");
        expect(agentRequests(gym)).toHaveLength(2);
    });
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

async function readSubmissions(
    gym: Gym,
): Promise<Array<{ delivery: string; displayText: string; runId: string }>> {
    const script = String.raw`
const { existsSync } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const databasePath = [
  "/home/rig/.server/sessions.sqlite",
  "/home/rig/.local/state/rig/sessions.sqlite",
  "/home/rig/.rig/sessions.sqlite",
].find(existsSync);
if (databasePath === undefined) throw new Error("Session database was not found.");
const database = new DatabaseSync(databasePath, { readOnly: true });
const session = database.prepare(
  "SELECT id FROM sessions WHERE parent_session_id IS NULL ORDER BY created_at_ms DESC LIMIT 1"
).get();
const submissions = database.prepare(
  "SELECT data_json FROM session_events WHERE session_id = ? AND type = 'message_submitted' ORDER BY seq"
).all(session.id).map(({ data_json }) => {
  const data = JSON.parse(data_json);
  return { delivery: data.delivery, displayText: data.displayText, runId: data.runId };
});
database.close();
process.stdout.write(JSON.stringify(submissions));
`;
    const result = await gym.runInContainer("node", ["-e", script]);
    expect(result.stderr).toBe("");
    return JSON.parse(result.stdout) as Array<{
        delivery: string;
        displayText: string;
        runId: string;
    }>;
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

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}
