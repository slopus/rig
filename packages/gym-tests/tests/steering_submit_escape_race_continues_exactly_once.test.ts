import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("steering submit and immediate Escape", () => {
    it("continues mixed already-applied and coalesced delayed steering once", async () => {
        const appliedMessage = "Steering applied before coalesced Escape.";
        const delayedMessage = "Steering delayed in the coalesced Escape burst.";
        const messages = [appliedMessage, delayedMessage];
        const releaseAppliedBoundary = deferred<void>();
        const releaseContinuation = deferred<void>();
        const gym = await createGym({
            inference: async (request, callIndex) => {
                if (callIndex === 0) {
                    await releaseAppliedBoundary.promise;
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf 'APPLIED_STEERING_BOUNDARY\\n'" },
                                id: "applied-steering-boundary",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    return {
                        content: [{ text: "UNREACHABLE_AFTER_APPLIED_STEERING", type: "text" }],
                        delayMs: 60_000,
                    };
                }

                expect(callIndex).toBe(2);
                const continuedTexts = request.context.messages.flatMap(userText);
                expect(continuedTexts.filter((text) => messages.includes(text))).toEqual(messages);
                await releaseContinuation.promise;
                return { content: [{ text: "MIXED_STEERING_RACE_CONTINUED", type: "text" }] };
            },
            rows: 40,
        });
        running.add(gym);

        submit(gym, "Start a run for mixed applied steering.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);
        submit(gym, appliedMessage);
        await gym.terminal.waitForText("Messages to be submitted after next tool call", 30_000);
        releaseAppliedBoundary.resolve();
        await gym.terminal.waitUntil(
            (snapshot) =>
                agentRequests(gym).length === 2 &&
                snapshot.rows.filter((row) => row.trim() === `› ${appliedMessage}`).length === 1 &&
                !snapshot.text.includes("Messages to be submitted after next tool call"),
            "the first steering message to be applied before Escape",
            30_000,
        );

        gym.terminal.write(`${delayedMessage}\r\x1b\x1b`);
        const continued = await gym.terminal.waitUntil(
            (snapshot) =>
                agentRequests(gym).length === 3 &&
                messages.every(
                    (message) =>
                        snapshot.rows.filter((row) => row.trim() === `› ${message}`).length === 1,
                ) &&
                !snapshot.text.includes("Messages to be submitted after next tool call"),
            "applied and delayed steering to continue from one coalesced Escape burst",
            30_000,
        );
        expect(continued.text).not.toContain("Session interrupted");

        const events = await readRaceEvents(gym);
        expect(events.abortRequested).toBe(1);
        expect(events.submittedTexts).toEqual(messages);
        expect(events.appliedCounts).toEqual([1, 1]);
        expect(events.firstAppliedBeforeSecondSubmitted).toBe(true);
        expect(events.pendingSubmittedIds).toEqual([]);
        await screenshot(gym, "mixed-applied-and-coalesced-delayed-continued.png");

        releaseContinuation.resolve();
        await gym.terminal.waitForText("MIXED_STEERING_RACE_CONTINUED", 30_000);
        expect(agentRequests(gym)).toHaveLength(3);
    }, 120_000);

    it.each([
        {
            label: "coalesced PTY burst",
            send(gym: Gym, messages: readonly string[]) {
                gym.terminal.write(`${messages.join("\r")}\r\x1b`);
            },
        },
        {
            label: "separate zero-wait PTY writes",
            send(gym: Gym, messages: readonly string[]) {
                for (const message of messages) {
                    gym.terminal.type(message);
                    gym.terminal.press("enter");
                }
                gym.terminal.press("escape");
            },
        },
        {
            label: "multiple zero-wait steering messages",
            send(gym: Gym, messages: readonly string[]) {
                for (const message of messages) {
                    gym.terminal.type(message);
                    gym.terminal.press("enter");
                }
                gym.terminal.write("\x1b\x1b");
            },
        },
    ])(
        "continues accepted steering once for $label",
        async ({ label, send }) => {
            const messages =
                label === "multiple zero-wait steering messages"
                    ? ["First immediate steering message.", "Second immediate steering message."]
                    : [`Immediate steering from ${label}.`];
            const releaseContinuation = deferred<void>();
            const gym = await createGym({
                inference: async (request, callIndex) => {
                    if (callIndex === 0) {
                        return {
                            content: [{ text: "UNREACHABLE_INITIAL_RESPONSE", type: "text" }],
                            delayMs: 60_000,
                        };
                    }

                    expect(callIndex).toBe(1);
                    const continuedTexts = request.context.messages.flatMap(userText);
                    expect(continuedTexts.filter((text) => messages.includes(text))).toEqual(
                        messages,
                    );
                    await releaseContinuation.promise;
                    return { content: [{ text: "STEERING_RACE_CONTINUED", type: "text" }] };
                },
                rows: 40,
            });
            running.add(gym);

            submit(gym, "Start a run for immediate steering.");
            await gym.terminal.waitForText("esc to interrupt", 30_000);

            send(gym, messages);

            const continued = await gym.terminal.waitUntil(
                (snapshot) =>
                    agentRequests(gym).length === 2 &&
                    snapshot.text.includes("esc to interrupt") &&
                    messages.every(
                        (message) =>
                            snapshot.rows.filter((row) => row.trim() === `› ${message}`).length ===
                            1,
                    ) &&
                    !snapshot.text.includes("Messages to be submitted after next tool call"),
                `${label} to continue every accepted steering message once`,
                30_000,
            );
            expect(continued.text).not.toContain("Session interrupted");
            expect(continued.text).not.toContain("There is no active run to steer");
            expect(continued.text).not.toContain("Sending pending messages");

            const events = await readRaceEvents(gym);
            expect(events.abortRequested).toBe(1);
            expect(events.submittedTexts).toEqual(messages);
            expect(events.appliedCounts).toEqual(messages.map(() => 1));
            expect(events.pendingSubmittedIds).toEqual([]);
            await screenshot(gym, `${slug(label)}-continued.png`);

            releaseContinuation.resolve();
            await gym.terminal.waitForText("STEERING_RACE_CONTINUED", 30_000);
            expect(agentRequests(gym)).toHaveLength(2);
        },
        120_000,
    );
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

async function readRaceEvents(gym: Gym): Promise<{
    abortRequested: number;
    appliedCounts: number[];
    firstAppliedBeforeSecondSubmitted: boolean;
    pendingSubmittedIds: string[];
    submittedTexts: string[];
}> {
    const script = String.raw`
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync("/home/rig/.rig/sessions.sqlite", { readOnly: true });
const session = database.prepare(
  "SELECT id FROM sessions WHERE parent_session_id IS NULL ORDER BY created_at_ms DESC LIMIT 1"
).get();
const events = database.prepare(
  "SELECT type, data_json FROM session_events WHERE session_id = ? ORDER BY seq"
).all(session.id).map((row) => ({ type: row.type, data: JSON.parse(row.data_json) }));
const submitted = events.filter((event) =>
  event.type === "message_submitted" && event.data.delivery === "steer"
);
const appliedIds = events.flatMap((event) =>
  event.type === "steering_applied" ? event.data.messageIds : []
);
const submittedIds = submitted.map((event) => event.data.message.id);
const firstAppliedIndex = events.findIndex((event) =>
  event.type === "steering_applied" && event.data.messageIds.includes(submittedIds[0])
);
const secondSubmittedIndex = events.findIndex((event) =>
  event.type === "message_submitted" && event.data.message.id === submittedIds[1]
);
database.close();
process.stdout.write(JSON.stringify({
  abortRequested: events.filter((event) => event.type === "abort_requested").length,
  appliedCounts: submittedIds.map((id) => appliedIds.filter((appliedId) => appliedId === id).length),
  firstAppliedBeforeSecondSubmitted:
    firstAppliedIndex >= 0 && secondSubmittedIndex >= 0 && firstAppliedIndex < secondSubmittedIndex,
  pendingSubmittedIds: submittedIds.filter((id) => !appliedIds.includes(id)),
  submittedTexts: submitted.map((event) => event.data.displayText),
}));
`;
    const result = await gym.runInContainer("node", ["-e", script]);
    expect(result.stderr).toBe("");
    return JSON.parse(result.stdout) as {
        abortRequested: number;
        appliedCounts: number[];
        firstAppliedBeforeSecondSubmitted: boolean;
        pendingSubmittedIds: string[];
        submittedTexts: string[];
    };
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}

function slug(value: string): string {
    return value.replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolvePromiseInner) => {
        resolvePromise = resolvePromiseInner;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}
