import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 68;
const ROWS = 18;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("pausing an active goal keeps the daemon available for resume", () => {
    it("aborts delayed inference, resumes the same goal, and completes a recovery continuation", async () => {
        const gym = await createGym({
            cols: COLS,
            inference: (_request, callIndex) => {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                text: "STALE_GOAL_RESPONSE_MUST_NOT_RENDER",
                                type: "text",
                            },
                        ],
                        delayMs: 30_000,
                    };
                }
                if (callIndex === 1) {
                    return {
                        content: [
                            {
                                arguments: { status: "blocked" },
                                id: "recovery-checkpoint",
                                name: "update_goal",
                                type: "toolCall",
                            },
                        ],
                        delayMs: 300,
                    };
                }
                return {
                    content: [
                        {
                            text: "Goal continuation recovered after pause.",
                            type: "text",
                        },
                    ],
                };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "/goal Verify active goal pause recovery");
        const active = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Goal started: Verify active goal pause recovery") &&
                snapshot.text.includes("esc to interrupt") &&
                agentRequests(gym).length === 1,
            "the first goal continuation to be actively waiting on inference",
            30_000,
        );
        assertHealthyTerminal(active, baseline);

        submit(gym, "/goal pause");
        const paused = await gym.terminal.waitForText("Goal paused.", 30_000);
        assertHealthyTerminal(paused, baseline);
        expect(paused.text).not.toContain("STALE_GOAL_RESPONSE_MUST_NOT_RENDER");

        const settled = await gym.terminal.waitUntil(
            (snapshot) => !snapshot.text.includes("esc to interrupt"),
            "the paused goal run to settle before resuming",
            30_000,
        );
        assertHealthyTerminal(settled, baseline);

        submit(gym, "/goal resume");
        const resumed = await gym.terminal.waitForText("Goal resumed.", 15_000);
        assertHealthyTerminal(resumed, baseline);

        const recovered = await gym.terminal.waitForText(
            "Goal continuation recovered after pause.",
            30_000,
        );
        assertHealthyTerminal(recovered, baseline);
        expect(recovered.text).not.toContain("STALE_GOAL_RESPONSE_MUST_NOT_RENDER");
        expect(agentRequests(gym)).toHaveLength(3);

        submit(gym, "/goal clear");
        const cleared = await gym.terminal.waitForText("Goal cleared.", 30_000);
        assertHealthyTerminal(cleared, baseline);
        expect(cleared.text).toContain("Ask Rig to do anything");
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

function assertHealthyTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
