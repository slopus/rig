import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 104;
const ROWS = 30;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("duplicate model tool call identifier handling", () => {
    it("runs neither a benign nor hostile action and makes the rejection unmistakable", async () => {
        const benignCommand = "printf 'benign ran\\n' > benign-action-ran.txt";
        const hostileCommand = "printf 'hostile ran\\n' > hostile-action-ran.txt";
        const gym = await createGym({
            cols: COLS,
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: benignCommand, workdir: "/workspace" },
                                id: "compromised-model-reused-id",
                                name: "exec_command",
                                type: "toolCall",
                            },
                            {
                                arguments: { cmd: hostileCommand, workdir: "/workspace" },
                                id: "compromised-model-reused-id",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(1);
                const toolResults = request.context.messages.filter(
                    (message) => message.role === "toolResult",
                );
                expect(toolResults).toHaveLength(2);
                expect(toolResults.every((message) => message.isError)).toBe(true);
                expect(new Set(toolResults.map((message) => message.toolCallId)).size).toBe(2);
                expect(JSON.stringify(toolResults)).toContain("No tools were run.");
                expect(JSON.stringify(request.context.messages)).not.toContain(
                    "compromised-model-reused-id",
                );
                return {
                    content: [{ text: "DUPLICATE_BATCH_RECOVERY_OK", type: "text" }],
                };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Inspect the workspace, but do not make any changes.");
        const rejected = await gym.terminal.waitUntil(
            (snapshot) => {
                const text = normalizeWhitespace(snapshot.text);
                return (
                    text.includes("Rig rejected this entire batch of 2 requested actions") &&
                    text.includes("The requests could not be safely distinguished") &&
                    text.includes("No tools were run") &&
                    text.includes("Ask Rig to do anything") &&
                    snapshot.scroll.atBottom
                );
            },
            "a complete and visible rejection of the ambiguous batch",
            30_000,
        );
        expect(rejected.text).toContain(benignCommand);
        expect(rejected.text).toContain(hostileCommand);
        expect(rejected.text).not.toContain("Running 1 tool");
        expect(rejected.text).not.toContain("Running 2 tools");
        expect(rejected.text).not.toContain("compromised-model-reused-id");
        expect(rejected.text).not.toContain("exec_command");
        expect(rejected.rows.filter((row) => row.includes("• Failed printf"))).toHaveLength(2);
        await expect(gym.readFile("benign-action-ran.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        await expect(gym.readFile("hostile-action-ran.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        assertHealthyTerminal(rejected, baseline);

        submit(gym, "Confirm that the session recovered without running those actions.");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("DUPLICATE_BATCH_RECOVERY_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy follow-up after the rejected batch",
            30_000,
        );
        expect(recovered.text).not.toContain("compromised-model-reused-id");
        assertHealthyTerminal(recovered, baseline);
        expect(agentRequests(gym)).toHaveLength(2);
    }, 120_000);

    it("allows identifier reuse on a later turn without erasing earlier audit history", async () => {
        const firstCommand = "printf 'first audited action\\n' > first-audited-action.txt";
        const reusedCommand = "printf 'reused id ran\\n' > reused-id-action-ran.txt";
        const providerId = "provider-id-from-earlier-turn";
        const gym = await createGym({
            cols: COLS,
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: firstCommand, workdir: "/workspace" },
                                id: providerId,
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolCallId: providerId,
                    });
                    return { content: [{ text: "FIRST_ACTION_AUDITED", type: "text" }] };
                }
                if (callIndex === 2) {
                    return {
                        content: [
                            {
                                arguments: { cmd: reusedCommand, workdir: "/workspace" },
                                id: providerId,
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(3);
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolCallId: providerId,
                });
                return { content: [{ text: "CROSS_TURN_ID_RECOVERY_OK", type: "text" }] };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Run the first action and keep a clear audit record.");
        const first = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("FIRST_ACTION_AUDITED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the first action and its visible audit record",
            30_000,
        );
        expect(first.text).toContain("Ran printf 'first audited action");
        await expect(gym.readFile("first-audited-action.txt")).resolves.toBe(
            "first audited action\n",
        );
        assertHealthyTerminal(first, baseline);

        submit(gym, "Run a later action even if its provider identifier repeats.");
        const reused = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CROSS_TURN_ID_RECOVERY_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "cross-turn identifier reuse completing normally",
            30_000,
        );
        expect(reused.text).toContain("Ran printf 'first audited action");
        expect(reused.text).toContain("Ran printf 'reused id ran");
        expect(reused.text).not.toContain(providerId);
        await expect(gym.readFile("reused-id-action-ran.txt")).resolves.toBe("reused id ran\n");
        assertHealthyTerminal(reused, baseline);
        expect(agentRequests(gym)).toHaveLength(4);
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

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/gu, " ");
}

function assertHealthyTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.rows.every((row) => [...row].length <= COLS)).toBe(true);
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.title).toContain("Rig");
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
