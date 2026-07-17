import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("interrupting an active shell command is honest about what stopped", () => {
    it("kills the real process, removes active status, and recovers without stale success", async () => {
        const command =
            "trap 'printf stopped > interrupted-process-state.txt; exit 143' TERM INT; printf started > interrupted-process-state.txt; printf 'ACTIVE_PROCESS_STARTED\\n'; while :; do sleep 1; done; printf completed > interrupted-process-state.txt";
        const gym = await createGym({
            cols: 96,
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 30_000 },
                                id: "interrupt-active-process",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(1);
                expect(request.context.messages.at(-1)).toMatchObject({ role: "user" });
                return {
                    content: [{ text: "RECOVERED_AFTER_STOPPED_COMMAND", type: "text" }],
                };
            },
            rows: 24,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Run the command, but be ready for me to stop it.");
        gym.terminal.press("enter");

        const active = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("• Running trap") &&
                snapshot.text.includes("└ ACTIVE_PROCESS_STARTED") &&
                snapshot.scroll.atBottom,
            "a visibly active real shell command",
            30_000,
        );
        expect(active.text).not.toContain("• Ran trap");
        expect(active.text).not.toContain("• Stopped trap");
        expect(active.text).not.toMatch(/session ID/iu);

        gym.terminal.press("escape");
        const stopped = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Session interrupted") &&
                snapshot.text.includes("• Stopped trap") &&
                !snapshot.text.includes("• Running trap") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "an interrupted command labelled stopped after its process exits",
            30_000,
        );
        expect(stopped.text).not.toContain("• Ran trap");
        expect(stopped.text).toContain("The active run was stopped.");
        expect(stopped.text).not.toMatch(/session ID/iu);
        expect(stopped.rows).toHaveLength(24);
        expect(stopped.text).toContain("gym off · /workspace");
        expect(stopped.text).not.toContain("�");
        expect(stopped.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(stopped.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        await expect
            .poll(() => gym.readFile("interrupted-process-state.txt"), { timeout: 10_000 })
            .toBe("stopped");

        gym.terminal.type("Confirm the stopped command did not break the session.");
        gym.terminal.press("enter");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("RECOVERED_AFTER_STOPPED_COMMAND") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy turn after stopping the command",
            30_000,
        );
        expect(recovered.text).toContain("• Stopped trap");
        expect(recovered.text).not.toContain("• Running trap");
        expect(recovered.text).not.toContain("• Ran trap");
        expect(recovered.text).not.toMatch(/session ID/iu);
        expect(recovered.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(recovered.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    }, 120_000);
});
