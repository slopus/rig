import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 58;
const ROWS = 20;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("structured questions navigate multiple and free-form answers", () => {
    it("uses arrow navigation across two questions and returns the exact answer payload", async () => {
        const gym = await createGym({
            cols: COLS,
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                questions: [
                                    {
                                        header: "Database",
                                        id: "database",
                                        options: [
                                            {
                                                description: "Use the existing relational stack.",
                                                label: "PostgreSQL",
                                            },
                                            {
                                                description: "Keep local setup lightweight.",
                                                label: "SQLite",
                                            },
                                            {
                                                description: "Use a document-oriented store.",
                                                label: "MongoDB",
                                            },
                                        ],
                                        question: "Which data store?",
                                    },
                                    {
                                        header: "Region",
                                        id: "region",
                                        options: [
                                            {
                                                description: "Deploy near the current team.",
                                                label: "US West",
                                            },
                                            {
                                                description: "Deploy near most customers.",
                                                label: "US East",
                                            },
                                        ],
                                        question: "Which deployment region?",
                                    },
                                ],
                            },
                            id: "question-workflow",
                            name: "request_user_input",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            text: "Recorded SQLite in Europe West.",
                            type: "text",
                        },
                    ],
                },
            ],
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Collect the deployment choices.");
        gym.terminal.press("enter");

        const firstQuestion = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Which data store? · 1 of 2") &&
                snapshot.text.includes("PostgreSQL") &&
                snapshot.text.includes("SQLite") &&
                snapshot.text.includes("gym off · /workspace"),
            "the first structured question and its choices",
            30_000,
        );
        assertHealthySmallTerminal(firstQuestion, baseline);

        gym.terminal.press("down");
        gym.terminal.press("enter");

        const secondQuestion = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Which deployment region? · 2 of 2") &&
                snapshot.text.includes("Type another answer") &&
                snapshot.text.includes("gym off · /workspace"),
            "the second structured question and free-form choice",
            30_000,
        );
        assertHealthySmallTerminal(secondQuestion, baseline);

        gym.terminal.press("down");
        gym.terminal.press("down");
        gym.terminal.press("enter");

        const freeform = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Type another answer") &&
                !snapshot.text.includes("Which deployment region? · 2 of 2") &&
                snapshot.text.includes("gym off · /workspace"),
            "the free-form answer composer",
            30_000,
        );
        assertHealthySmallTerminal(freeform, baseline);

        gym.terminal.type("Europe West");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Recorded SQLite in Europe West.") &&
                snapshot.text.includes("gym off · /workspace"),
            "the recorded structured answers and complete footer",
            30_000,
        );
        assertHealthySmallTerminal(completed, baseline);
        expect(completed.text).toContain("Ask Rig to do anything");

        const requests = agentRequests(gym);
        expect(requests).toHaveLength(2);
        const toolResult = requests[1]?.context.messages.at(-1);
        expect(toolResult).toMatchObject({
            isError: false,
            role: "toolResult",
            toolCallId: "question-workflow",
            toolName: "request_user_input",
        });
        expect(toolResult?.content).toEqual([
            {
                text: '{"answers":{"database":{"answers":["SQLite"]},"region":{"answers":["Europe West"]}}}',
                type: "text",
            },
        ]);
    });
});

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    );
}

function assertHealthySmallTerminal(
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
    expect(snapshot.text).not.toContain("\x1b[200~");
    expect(snapshot.text).not.toContain("\x1b[201~");
}
