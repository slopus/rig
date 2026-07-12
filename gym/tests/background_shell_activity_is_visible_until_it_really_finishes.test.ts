import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("background shell activity stays visible until it really finishes", () => {
    it("shows a human process count, hides the internal session ID, and clears the count", async () => {
        const command =
            "printf 'BACKGROUND_PROCESS_STARTED\\n'; sleep 3; printf 'finished\\n' > background-process-state.txt";
        const gym = await createGym({
            cols: 88,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, yield_time_ms: 250 },
                                id: "start-background-process",
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
                    expect(toolResultText(lastMessage?.content)).toMatch(
                        /Process running with session ID \d+/u,
                    );
                    return {
                        content: [
                            {
                                text: "The command is still running, and Rig is showing that activity.",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({ role: "user" });
                return {
                    content: [{ text: "The terminal is ready for more work.", type: "text" }],
                };
            },
            rows: 24,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Start the command and tell me if anything is still running.");
        gym.terminal.press("enter");

        const active = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The command is still running") &&
                snapshot.text.includes("1 process") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "an idle composer that still discloses the background process",
            30_000,
        );
        expect(active.text).toContain("• Ran printf");
        expect(active.text).toContain("Command is still running in the background.");
        expect(active.text).not.toMatch(/session ID/iu);
        expect(active.text).not.toContain("• Running printf");
        expect(active.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(active.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        const finished = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The command is still running") &&
                !snapshot.text.includes("1 process") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the background process count to clear after real process exit",
            30_000,
        );
        await expect(gym.readFile("background-process-state.txt")).resolves.toBe("finished\n");
        expect(finished.text).not.toMatch(/session ID/iu);
        expect(finished.rows).toHaveLength(24);
        expect(finished.text).toContain("Gym Off • /workspace");
        expect(finished.text).not.toContain("�");
        expect(finished.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(finished.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("Confirm you are ready for the next request.");
        gym.terminal.press("enter");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("The terminal is ready for more work.") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy turn after the background process completed",
            30_000,
        );
        expect(recovered.text).not.toContain("1 process");
        expect(recovered.text).not.toMatch(/session ID/iu);
        expect(recovered.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(recovered.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    }, 120_000);
});

function toolResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
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
