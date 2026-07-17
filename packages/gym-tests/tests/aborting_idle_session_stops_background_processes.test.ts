import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("aborting an idle session stops its background processes", () => {
    it("prevents a delayed command from acting after the model has finished its turn", async () => {
        const command =
            "printf 'DELAYED_ACTION_ARMED\\n'; sleep 6; printf 'escaped after abort\\n' > delayed-action.txt";
        const gym = await createGym({
            cols: 92,
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 250 },
                                id: "arm-delayed-action",
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
                        toolName: "exec_command",
                    });
                    return {
                        content: [
                            {
                                text: "The delayed action is still running after this response.",
                                type: "text",
                            },
                        ],
                    };
                }

                if (callIndex === 2) {
                    expect(request.context.messages.at(-1)).toMatchObject({ role: "user" });
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "sleep 7; if [ -e delayed-action.txt ]; then printf 'DELAYED_ACTION_%s\\n' 'ESCAPED'; else printf 'ABORT_HOLD_CONFIRMED\\n'; fi",
                                    yield_time_ms: 10_000,
                                },
                                id: "verify-abort-held",
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
                    toolName: "exec_command",
                });
                expect(JSON.stringify(request.context.messages.at(-1)?.content)).toContain(
                    "ABORT_HOLD_CONFIRMED",
                );
                return {
                    content: [{ text: "The stopped process stayed stopped.", type: "text" }],
                };
            },
            rows: 24,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Start the delayed task and finish your response immediately.");
        const idleWithProcess = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The delayed action is still running") &&
                snapshot.text.includes("1 background terminal running") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the completed turn with a background process still active",
            30_000,
        );
        assertHealthy(idleWithProcess, baseline);

        submit(gym, "/abort");
        const stopped = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Stopped 1 background process.") &&
                !snapshot.text.includes("background terminal running") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a clear confirmation that the idle session's process was stopped",
            30_000,
        );
        expect(stopped.text).not.toContain("No active run.");
        assertHealthy(stopped, baseline);

        submit(gym, "Wait past the delayed action's deadline and verify it stayed stopped.");
        const held = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The stopped process stayed stopped.") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a real command confirming the marker stayed absent past its deadline",
            30_000,
        );
        await expect(gym.readFile("delayed-action.txt")).rejects.toMatchObject({ code: "ENOENT" });
        expect(held.text).not.toContain("DELAYED_ACTION_ESCAPED");
        assertHealthy(held, baseline);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function assertHealthy(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(24);
    expect(snapshot.scroll.visibleRows).toBe(24);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.text).toContain("gym off · /workspace");
    expect(snapshot.text).not.toContain("�");
}
