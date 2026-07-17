import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("transient inference failures", () => {
    it("retries a disconnected fetch without ending the turn", async () => {
        const gym = await createGym({
            inference(_request, callIndex) {
                if (callIndex === 0) return { disconnect: true };
                expect(callIndex).toBe(1);
                return { content: [{ text: "RETRY_RECOVERED", type: "text" }] };
            },
        });
        running.add(gym);

        gym.terminal.type("Recover this turn without asking me to continue.");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitForText("RETRY_RECOVERED", 30_000);
        expect(completed.text).not.toContain("Error fetch failed");
        expect(
            gym.inference.requests.filter(
                (request) => request.options.sessionId?.endsWith(":title") !== true,
            ),
        ).toHaveLength(2);
        expect(completed.text).toContain("Ask Rig to do anything");
    }, 120_000);

    it("retries a zero-content WebSocket failure after a completed tool without replaying it", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf 'tool-ran\\n' >> tool-runs.txt" },
                                id: "run-once-before-websocket-failure",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "exec_command",
                });
                if (callIndex === 1) {
                    return {
                        content: [],
                        errorMessage: "WebSocket error",
                        stopReason: "error",
                    };
                }
                expect(callIndex).toBe(2);
                return { content: [{ text: "POST_TOOL_WEBSOCKET_RECOVERED", type: "text" }] };
            },
        });
        running.add(gym);

        gym.terminal.type("Run the tool and recover if the next inference transport fails.");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitForText("POST_TOOL_WEBSOCKET_RECOVERED", 30_000);
        expect(completed.text).not.toContain("Error WebSocket error");
        expect(await gym.readFile("tool-runs.txt")).toBe("tool-ran\n");
        expect(
            gym.inference.requests.filter(
                (request) => request.options.sessionId?.endsWith(":title") !== true,
            ),
        ).toHaveLength(3);
        expect(completed.text).toContain("Ask Rig to do anything");
    }, 120_000);
});
