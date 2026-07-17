import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const RESUME_MARKER = "BACKGROUND_RESUME_MARKER";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("resuming a session with historical background terminals", () => {
    it("does not report old terminals as newly completed after the next tool call", async () => {
        const oldCommand = "sleep 1; printf 'OLD_BACKGROUND_FINISHED\\n'";
        const gym = await createGym({
            cols: 96,
            entrypoint: [
                "bash",
                "-lc",
                `node /app/packages/rig/dist/main.js; echo ${RESUME_MARKER}; exec node /app/packages/rig/dist/main.js resume --last`,
            ],
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: oldCommand, yield_time_ms: 100 },
                                id: "start-old-background-terminal",
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
                        content: [{ text: "OLD_BACKGROUND_STARTED", type: "text" }],
                    };
                }
                if (callIndex === 2) {
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf 'FOLLOW_UP_TOOL_RAN\\n'" },
                                id: "run-tool-after-resume",
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
                return {
                    content: [{ text: "RESUMED_FOLLOW_UP_COMPLETE", type: "text" }],
                };
            },
            rows: 60,
        });
        running.add(gym);

        gym.terminal.type("Start one background terminal and finish this turn.");
        gym.terminal.press("enter");

        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes(`Background terminal completed · ${oldCommand}`) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace"),
            "the original background terminal completion",
            30_000,
        );

        gym.terminal.press("ctrlD");
        await gym.terminal.waitUntil(
            (snapshot) => {
                const marker = snapshot.text.indexOf(RESUME_MARKER);
                if (marker < 0) return false;
                const resumed = snapshot.text.slice(marker);
                return (
                    resumed.includes("OLD_BACKGROUND_STARTED") &&
                    resumed.includes("Ask Rig to do anything") &&
                    resumed.includes("gym off · /workspace")
                );
            },
            "the resumed historical transcript",
            30_000,
        );

        gym.terminal.type("Run one foreground tool after resuming.");
        gym.terminal.press("enter");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("RESUMED_FOLLOW_UP_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off · /workspace"),
            "the first tool-backed turn after resume",
            30_000,
        );
        const resumed = completed.text.slice(completed.text.indexOf(RESUME_MARKER));
        expect(resumed).toContain("FOLLOW_UP_TOOL_RAN");
        expect(resumed).not.toContain(`Background terminal completed · ${oldCommand}`);
    }, 120_000);
});
