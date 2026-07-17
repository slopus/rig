import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Escape with pending steering", () => {
    it("interrupts and immediately resumes inference with every pending message once", async () => {
        const firstPending = "Preserve this first pending direction.";
        const secondPending = "Preserve this second pending direction.";
        const releaseContinuation = deferred<void>();
        const gym = await createGym({
            cols: 100,
            inference: async (request, callIndex) => {
                if (callIndex === 0) {
                    return {
                        content: [{ text: "UNREACHABLE_DELAYED_RESPONSE", type: "text" }],
                        delayMs: 60_000,
                    };
                }

                expect(callIndex).toBe(1);
                const continuedUserTexts = request.context.messages.flatMap(userText);
                expect(continuedUserTexts.filter((text) => text === firstPending)).toHaveLength(1);
                expect(continuedUserTexts.filter((text) => text === secondPending)).toHaveLength(1);
                await releaseContinuation.promise;
                return { content: [{ text: "CONTINUATION_COMPLETE", type: "text" }] };
            },
            rows: 36,
        });
        running.add(gym);

        submit(gym, "Begin inference and wait for my steering.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);

        submit(gym, firstPending);
        submit(gym, secondPending);
        const pending = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Messages to be submitted after next tool call") &&
                snapshot.text.includes("(esc to send now)") &&
                snapshot.text.includes(`└ ${firstPending}`) &&
                snapshot.text.includes(secondPending),
            "both pending steering messages",
            30_000,
        );
        expect(rowContaining(pending.rows, "Messages to be submitted")).toMatch(/^ • /u);
        expect(rowContaining(pending.rows, `└ ${firstPending}`)).toMatch(/^  └ /u);
        expect(rowContaining(pending.rows, secondPending)).toMatch(/^    /u);
        expect(pending.rows.filter((row) => row.includes("└"))).toHaveLength(1);
        expect(pendingSteeringRows(pending.rows, [firstPending, secondPending])).not.toMatch(
            /[│├↳]/u,
        );
        await screenshot(gym, "revised-pending-before-escape.png");

        gym.terminal.resize(48, 36);
        const narrow = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Messages to be submitted") &&
                snapshot.text.includes(firstPending) &&
                snapshot.text.includes(secondPending),
            "dedented pending steering at narrow width",
            30_000,
        );
        expect(rowContaining(narrow.rows, "Messages to be submitted")).toMatch(/^ • /u);
        expect(rowContaining(narrow.rows, `└ ${firstPending}`)).toMatch(/^  └ /u);
        expect(rowContaining(narrow.rows, secondPending)).toMatch(/^    /u);
        expect(narrow.rows.filter((row) => row.includes("└"))).toHaveLength(1);
        expect(pendingSteeringRows(narrow.rows, [firstPending, secondPending])).not.toMatch(
            /[│├↳]/u,
        );
        await screenshot(gym, "revised-pending-narrow-wrapped.png");

        gym.terminal.resize(100, 36);
        gym.terminal.press("escape");
        const resumed = await gym.terminal.waitUntil(
            (snapshot) =>
                agentRequests(gym).length === 2 &&
                snapshot.text.includes("esc to interrupt") &&
                !snapshot.text.includes("Messages to be submitted after next tool call") &&
                snapshot.rows.filter((row) => row.trim() === `› ${firstPending}`).length === 1 &&
                snapshot.rows.filter((row) => row.trim() === `› ${secondPending}`).length === 1,
            "pending steering delivered into an immediate continuation",
            30_000,
        );
        await screenshot(gym, "revised-pending-resumed-immediately.png");
        assertDeliveredExactlyOnce(resumed, [firstPending, secondPending]);
        expect(resumed.text).not.toContain("Session interrupted");

        releaseContinuation.resolve();
        const completed = await gym.terminal.waitForText("CONTINUATION_COMPLETE", 30_000);
        await screenshot(gym, "revised-pending-resume-completed.png");
        assertDeliveredExactlyOnce(completed, [firstPending, secondPending]);

        const requests = agentRequests(gym);
        expect(requests).toHaveLength(2);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function rowContaining(rows: readonly string[], text: string): string {
    const row = rows.find((candidate) => candidate.includes(text));
    expect(row).toBeDefined();
    return row ?? "";
}

function pendingSteeringRows(rows: readonly string[], messages: readonly string[]): string {
    return rows
        .filter(
            (row) =>
                row.includes("Messages to be submitted") ||
                messages.some((message) => row.includes(message)),
        )
        .join("\n");
}

function assertDeliveredExactlyOnce(
    snapshot: { rows: readonly string[]; text: string },
    messages: readonly string[],
): void {
    expect(snapshot.text).not.toContain("Messages to be submitted after next tool call");
    expect(snapshot.text).not.toContain("(esc to send now)");
    for (const message of messages) {
        expect(snapshot.rows.filter((row) => row.trim() === `› ${message}`)).toHaveLength(1);
        expect(snapshot.text).not.toContain(`└ ${message}`);
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

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}
