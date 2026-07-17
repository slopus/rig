import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 88;
const ROWS = 28;
const running = new Set<Gym>();

const planTransitions = [
    [
        { status: "in_progress", step: "Inspect the behavior" },
        { status: "pending", step: "Implement the change" },
        { status: "pending", step: "Verify the result" },
    ],
    [
        { status: "completed", step: "Inspect the behavior" },
        { status: "completed", step: "Implement the change" },
        { status: "in_progress", step: "Verify the result" },
    ],
    [
        { status: "completed", step: "Inspect the behavior" },
        { status: "completed", step: "Implement the change" },
        { status: "completed", step: "Verify the result" },
    ],
] as const;

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("update_plan transitions render human-readable progress", () => {
    it("reports each real tool transition and leaves the terminal ready for follow-up", async () => {
        const gym = await createGym({
            cols: COLS,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    return planToolCall(0);
                }

                if (callIndex >= 1 && callIndex <= 3) {
                    expect(lastMessage).toMatchObject({
                        content: [{ text: "Plan updated", type: "text" }],
                        isError: false,
                        role: "toolResult",
                        toolCallId: `plan-transition-${String(callIndex - 1)}`,
                        toolName: "update_plan",
                    });
                    return callIndex < 3
                        ? planToolCall(callIndex)
                        : {
                              content: [{ text: "PLAN_TRANSITIONS_COMPLETE", type: "text" }],
                          };
                }

                expect(callIndex).toBe(4);
                expect(lastMessage).toMatchObject({ role: "user" });
                expect(JSON.stringify(lastMessage)).toContain(
                    "Confirm the plan workflow still accepts input.",
                );
                return { content: [{ text: "PLAN_FOLLOW_UP_ACCEPTED", type: "text" }] };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Track a three-step implementation plan through completion.");

        const started = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Plan updated: 0 completed, 1 in progress, 2 pending") &&
                snapshot.text.includes("gym off · /workspace"),
            "the started plan and complete footer",
            30_000,
        );
        assertHealthyTerminal(started, baseline);
        expect(started.text).toContain("Used Update plan");
        expect(started.text).not.toContain("update_plan");

        const verifying = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Plan updated: 2 completed, 1 in progress, 0 pending") &&
                snapshot.text.includes("gym off · /workspace"),
            "the verifying plan and complete footer",
            30_000,
        );
        assertHealthyTerminal(verifying, baseline);

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Plan updated: 3 completed, 0 in progress, 0 pending") &&
                snapshot.text.includes("PLAN_TRANSITIONS_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace"),
            "the completed plan and idle composer",
            30_000,
        );
        assertHealthyTerminal(completed, baseline);
        expect(completed.text).toContain("Update plan");
        expect(completed.text).not.toContain("update_plan");

        submit(gym, "Confirm the plan workflow still accepts input.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PLAN_FOLLOW_UP_ACCEPTED") &&
                snapshot.text.includes("gym off · /workspace"),
            "the plan follow-up and complete footer",
            30_000,
        );
        assertHealthyTerminal(followUp, baseline);
        expect(followUp.text).toContain("Ask Rig to do anything");

        const requests = agentRequests(gym);
        expect(requests).toHaveLength(5);
        for (let index = 1; index <= 3; index += 1) {
            expect(requests[index]?.context.messages.at(-1)).toMatchObject({
                content: [{ text: "Plan updated", type: "text" }],
                isError: false,
                role: "toolResult",
                toolName: "update_plan",
            });
        }
    }, 60_000);
});

function planToolCall(index: number) {
    return {
        content: [
            {
                arguments: {
                    explanation: `Plan transition ${String(index + 1)} of 3.`,
                    plan: planTransitions[index] ?? [],
                },
                id: `plan-transition-${String(index)}`,
                name: "update_plan",
                type: "toolCall" as const,
            },
        ],
    };
}

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
    expect(snapshot.text.includes("gym off") || snapshot.text.includes("esc to interrupt")).toBe(
        true,
    );
    if (snapshot.text.includes("gym off")) expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
