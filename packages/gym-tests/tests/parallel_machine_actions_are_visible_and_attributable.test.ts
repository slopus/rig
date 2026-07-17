import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const commands = [
    "sleep 3; touch alpha.done",
    "sleep 3; touch beta.done",
    "sleep 3; touch gamma.done",
] as const;

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("parallel machine actions are visible and attributable", () => {
    it("shows every active process and each completed result", async () => {
        const gym = await createGym({
            cols: 100,
            inference(request, callIndex) {
                if (callIndex === 0) {
                    expect(lastUserText(request.context.messages)).toContain(
                        "Run the three local checks",
                    );
                    return {
                        content: commands.map((cmd, index) => ({
                            arguments: { cmd, workdir: "/workspace", yield_time_ms: 5_000 },
                            id: `parallel-command-${String(index + 1)}`,
                            name: "exec_command",
                            type: "toolCall" as const,
                        })),
                    };
                }

                if (callIndex === 1) {
                    const results = request.context.messages.filter(
                        (message) => message.role === "toolResult",
                    );
                    expect(results).toHaveLength(3);
                    expect(results.map((message) => message.toolCallId).sort()).toEqual([
                        "parallel-command-1",
                        "parallel-command-2",
                        "parallel-command-3",
                    ]);
                    expect(
                        results.every(
                            (message) =>
                                message.toolName === "exec_command" && message.isError === false,
                        ),
                    ).toBe(true);
                    return {
                        content: [{ text: "ALL_PARALLEL_ACTIONS_COMPLETE", type: "text" }],
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastUserText(request.context.messages)).toContain(
                    "Confirm no work is still running",
                );
                return { content: [{ text: "PARALLEL_ACTIONS_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: 30,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Run the three local checks so I can see every action.");
        const active = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Running 3 tools") &&
                commands.every((command) => snapshot.text.includes(command)) &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "three visible commands and processes running together",
            30_000,
        );
        const activeCommandRows = active.rows.filter((row) => row.includes("• Running sleep 3"));
        expect(activeCommandRows).toHaveLength(3);
        expect(
            active.rows.some(
                (row) => row.trim() === "› Run the three local checks so I can see every action.",
            ),
        ).toBe(true);
        expect(active.text).not.toContain("• Ran sleep 3");
        expect(active.text).not.toContain("parallel-command-");
        expect(active.text).not.toContain("exec_command");
        assertHealthyTerminal(active, baseline);

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("ALL_PARALLEL_ACTIONS_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                commands.every((command) => snapshot.text.includes(`Ran ${command}`)) &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "three completed commands and idle composer",
            30_000,
        );
        const completedCommandRows = completed.rows.filter((row) => row.includes("• Ran sleep 3"));
        const resultRows = completed.rows.filter((row) => row.trimStart().startsWith("└"));
        expect(completedCommandRows).toHaveLength(3);
        expect(resultRows).toHaveLength(3);
        expect(completed.rows.some((row) => row.trim() === "• ALL_PARALLEL_ACTIONS_COMPLETE")).toBe(
            true,
        );
        expect(completed.text).not.toContain("Running 1 tool");
        expect(completed.text).not.toContain("Running 2 tools");
        expect(completed.text).not.toContain("Running 3 tools");
        expect(completed.text).not.toContain("processes");
        expect(completed.text).not.toContain("parallel-command-");
        expect(completed.text).not.toContain("exec_command");
        assertHealthyTerminal(completed, baseline);

        await Promise.all(
            ["alpha.done", "beta.done", "gamma.done"].map((path) =>
                expect(gym.readFile(path)).resolves.toBe(""),
            ),
        );

        submit(gym, "Confirm no work is still running.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARALLEL_ACTIONS_FOLLOW_UP_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace") &&
                snapshot.scroll.atBottom,
            "follow-up after all parallel work completed",
            30_000,
        );
        expect(followUp.text).not.toContain("processes");
        expect(followUp.text).not.toContain("�");
        assertHealthyTerminal(followUp, baseline);
        expect(agentRequests(gym)).toHaveLength(3);
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

function lastUserText(messages: readonly { role: string; content: unknown }[]): string {
    const message = [...messages].reverse().find((candidate) => candidate.role === "user");
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content
        .filter(
            (block): block is { text: string; type: "text" } =>
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "text" &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
}

function assertHealthyTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(30);
    expect(snapshot.scroll.visibleRows).toBe(30);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(100);
    expect(snapshot.cursor.y).toBeLessThan(30);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
