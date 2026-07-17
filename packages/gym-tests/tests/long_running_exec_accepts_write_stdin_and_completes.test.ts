import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("long-running exec accepts input and completes", () => {
    it("hands the yielded numeric session to write_stdin and remains usable", async () => {
        const command =
            "printf 'WAITING_FOR_INPUT\\n'; IFS= read -r reply; printf 'SESSION_RECEIVED:%s\\n' \"$reply\"; printf '%s\\n' \"$reply\" > interactive-result.txt; printf 'PROCESS_COMPLETE\\n'";
        let yieldedSessionId: number | undefined;
        const gym = await createGym({
            cols: 90,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const resultText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 2_000 },
                                id: "start-interactive-command",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    expect(resultText).toContain("WAITING_FOR_INPUT");
                    const match = resultText.match(/Process running with session ID (\d+)/u);
                    expect(match).not.toBeNull();
                    yieldedSessionId = Number(match?.[1]);
                    expect(Number.isInteger(yieldedSessionId)).toBe(true);
                    expect(yieldedSessionId).toBeGreaterThan(0);
                    return {
                        content: [
                            {
                                arguments: {
                                    chars: "gym-input\n",
                                    session_id: yieldedSessionId,
                                    yield_time_ms: 2_000,
                                },
                                id: "send-interactive-input",
                                name: "write_stdin",
                                type: "toolCall",
                            },
                        ],
                        delayMs: 1_000,
                    };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "write_stdin",
                    });
                    expect(resultText).toContain("Process exited with code 0");
                    expect(resultText).toContain("SESSION_RECEIVED:gym-input");
                    expect(resultText).toContain("PROCESS_COMPLETE");
                    expect(resultText).not.toContain("Process running with session ID");
                    return {
                        content: [{ text: "LONG_RUNNING_FLOW_COMPLETE", type: "text" }],
                        delayMs: 1_000,
                    };
                }

                expect(callIndex).toBe(3);
                expect(lastMessage).toMatchObject({ role: "user" });
                expect(resultText).toContain("Confirm the terminal still works.");
                return {
                    content: [{ text: "SESSION_FOLLOW_UP_ACCEPTED", type: "text" }],
                };
            },
            rows: 26,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Run an interactive command and send its requested input.");
        gym.terminal.press("enter");

        const progressing = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("• Running printf") &&
                snapshot.text.includes("└ WAITING_FOR_INPUT") &&
                snapshot.scroll.atBottom,
            "the active command and its initial progress",
            30_000,
        );
        expect(progressing.text).not.toContain("• Ran printf");
        expect(progressing.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(progressing.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        const yielded = await gym.terminal.waitUntil(
            (snapshot) =>
                yieldedSessionId !== undefined &&
                snapshot.text.includes("• Ran printf") &&
                snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("WAITING_FOR_INPUT") &&
                snapshot.scroll.atBottom,
            "the yielded command after tool execution ended",
            30_000,
        );
        expect(yielded.text).toContain("Ran printf");
        expect(yielded.text).not.toContain("• Running printf");
        expect(yielded.text).toContain("1 background terminal running");
        expect(yielded.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(yielded.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        const inputSent = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Interacted with background terminal") &&
                snapshot.text.includes("gym-input") &&
                snapshot.scroll.atBottom,
            "write_stdin to finish the interactive command",
            30_000,
        );
        expect(inputSent.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(inputSent.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("LONG_RUNNING_FLOW_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "completed long-running flow and idle composer",
            30_000,
        );
        expect(yieldedSessionId).toBeTypeOf("number");
        await expect(gym.readFile("interactive-result.txt")).resolves.toBe("gym-input\n");
        expect(completed.rows).toHaveLength(26);
        expect(completed.scroll.visibleRows).toBe(26);
        expect(completed.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(completed.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(completed.text).toContain("gym off · /workspace");
        expect(completed.text).not.toContain("�");
        expect(completed.cursor.x).toBeLessThan(90);
        expect(completed.cursor.y).toBeLessThan(26);

        gym.terminal.type("Confirm the terminal still works.");
        gym.terminal.press("enter");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("SESSION_FOLLOW_UP_ACCEPTED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up turn after the interactive command",
            30_000,
        );
        expect(followUp.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(followUp.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(followUp.text).toContain("gym off · /workspace");
        expect(followUp.text).not.toContain("�");

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests).toHaveLength(4);
        expect(agentRequests[1]?.context.messages.at(-1)).toMatchObject({
            isError: false,
            role: "toolResult",
            toolName: "exec_command",
        });
        expect(agentRequests[2]?.context.messages.at(-1)).toMatchObject({
            isError: false,
            role: "toolResult",
            toolName: "write_stdin",
        });
        expect(inputSent.text).not.toContain("Edited Write stdin");
    }, 120_000);
});
