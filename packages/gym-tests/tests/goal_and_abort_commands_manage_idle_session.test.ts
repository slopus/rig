import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 68;
const ROWS = 18;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("goal and abort commands manage an idle session", () => {
    it("starts, inspects, pauses, resumes, and clears a goal before reporting no active run", async () => {
        const gym = await createGym({
            cols: COLS,
            inference: (_request, callIndex) => {
                if (callIndex === 0 || callIndex === 2) {
                    return {
                        content: [
                            {
                                arguments: { status: "blocked" },
                                id: `block-goal-${String(callIndex)}`,
                                name: "update_goal",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                return {
                    content: [
                        {
                            text:
                                callIndex === 1
                                    ? "First goal checkpoint reached."
                                    : "Second goal checkpoint reached.",
                            type: "text",
                        },
                    ],
                };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "/goal Ship a verified release");
        const started = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Goal started: Ship a verified release") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "the started goal with the normal status bar",
            30_000,
        );
        assertHealthyTerminal(started, baseline);
        const firstCheckpoint = await gym.terminal.waitForText(
            "First goal checkpoint reached.",
            30_000,
        );
        assertHealthyTerminal(firstCheckpoint, baseline);
        await waitForAgentRequestCount(gym, 2);

        submit(gym, "/goal");
        const blocked = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Status: Blocked") &&
                snapshot.text.includes("Objective: Ship a verified release"),
            "the blocked goal status",
            30_000,
        );
        assertHealthyTerminal(blocked, baseline);

        submit(gym, "/goal pause");
        const paused = await gym.terminal.waitForText("Goal paused.", 30_000);
        assertHealthyTerminal(paused, baseline);

        submit(gym, "/goal");
        const pausedStatus = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Status: Paused") &&
                snapshot.text.includes("Objective: Ship a verified release"),
            "the paused goal status",
            30_000,
        );
        assertHealthyTerminal(pausedStatus, baseline);

        submit(gym, "/goal resume");
        const resumed = await gym.terminal.waitForText("Goal resumed.", 30_000);
        assertHealthyTerminal(resumed, baseline);
        const secondCheckpoint = await gym.terminal.waitForText(
            "Second goal checkpoint reached.",
            30_000,
        );
        assertHealthyTerminal(secondCheckpoint, baseline);
        await waitForAgentRequestCount(gym, 4);

        submit(gym, "/goal clear");
        const cleared = await gym.terminal.waitForText("Goal cleared.", 30_000);
        assertHealthyTerminal(cleared, baseline);

        submit(gym, "/goal");
        const emptyGoal = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("No goal is set.") &&
                snapshot.text.includes("objective to start"),
            "the empty goal status",
            30_000,
        );
        assertHealthyTerminal(emptyGoal, baseline);

        await gym.terminal.waitUntil(
            (snapshot) => !snapshot.text.includes("esc to interrupt"),
            "the cleared goal run to become idle",
            30_000,
        );
        submit(gym, "/abort");
        const noActiveRun = await gym.terminal.waitForText("No active run.", 30_000);
        assertHealthyTerminal(noActiveRun, baseline);
        expect(noActiveRun.text).toContain("Ask Rig to do anything");
        expect(agentRequests(gym)).toHaveLength(4);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

async function waitForAgentRequestCount(gym: Gym, count: number): Promise<void> {
    await gym.terminal.waitUntil(
        () => agentRequests(gym).length >= count,
        `${String(count)} goal-continuation inference request${count === 1 ? "" : "s"}`,
        30_000,
    );
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
