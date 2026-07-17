import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("inference transport retries", () => {
    it("recovers from a disconnected request before response content", async () => {
        const gym = await createGym({
            inference(_request, callIndex) {
                if (callIndex === 0) return { disconnect: true };
                expect(callIndex).toBe(1);
                return { content: [{ text: "SAFE_TRANSPORT_RECOVERY", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Recover this turn without asking me to continue.");

        const completed = await gym.terminal.waitForText("SAFE_TRANSPORT_RECOVERY", 30_000);
        expect(completed.text).not.toContain("Error fetch failed");
        expect(agentRequests(gym)).toHaveLength(2);
        expect(completed.text).toContain("Ask Rig to do anything");
        await captureProof(gym, "safe-transport-recovery.png");
    }, 120_000);

    it.each([
        ["HTTP_503_IS_NOT_TRANSPORT", { body: "HTTP_503_IS_NOT_TRANSPORT", httpStatus: 503 }],
        [
            "PROVIDER_RETRY_PROSE_IS_NOT_TRANSPORT",
            {
                content: [],
                errorMessage:
                    "Codex error: An error occurred while processing your request. You can retry your request, or contact support. PROVIDER_RETRY_PROSE_IS_NOT_TRANSPORT",
                stopReason: "error" as const,
            },
        ],
        [
            "GENERIC_TERMINATED_IS_NOT_TRANSPORT",
            {
                content: [],
                errorMessage: "GENERIC_TERMINATED_IS_NOT_TRANSPORT: request terminated",
                stopReason: "error" as const,
            },
        ],
    ])(
        "does not retry %s",
        async (visibleFailure, firstResponse) => {
            const gym = await createGym({
                inference: [
                    firstResponse,
                    { content: [{ text: "FORBIDDEN_GENERIC_RECOVERY", type: "text" }] },
                ],
            });
            running.add(gym);

            submit(gym, "Expose the scripted provider failure.");

            const failed = await gym.terminal.waitForText(visibleFailure, 30_000);
            expect(failed.text).not.toContain("FORBIDDEN_GENERIC_RECOVERY");
            expect(agentRequests(gym)).toHaveLength(1);
            expect(failed.text).toContain("Ask Rig to do anything");
            if (visibleFailure === "HTTP_503_IS_NOT_TRANSPORT") {
                await captureProof(gym, "visible-non-retry-http-failure.png");
            }
        },
        120_000,
    );

    it("does not retry a transport failure after streamed text", async () => {
        const gym = await createGym({
            inference: [
                {
                    content: [{ text: "TEXT_BEFORE_TRANSPORT_FAILURE", type: "text" }],
                    errorMessage: "WebSocket error",
                    stopReason: "error",
                },
                { content: [{ text: "FORBIDDEN_TEXT_REPLAY", type: "text" }] },
            ],
        });
        running.add(gym);

        submit(gym, "Do not replay text after a transport failure.");

        const failed = await gym.terminal.waitForText("WebSocket error", 30_000);
        expect(failed.text).toContain("TEXT_BEFORE_TRANSPORT_FAILURE");
        expect(failed.text).not.toContain("FORBIDDEN_TEXT_REPLAY");
        expect(agentRequests(gym)).toHaveLength(1);
    }, 120_000);

    it("does not retry a transport failure after a streamed tool call", async () => {
        const gym = await createGym({
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "printf 'must-not-run\\n' >> streamed-tool.txt" },
                            id: "streamed-before-failure",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                    errorMessage: "WebSocket error",
                    stopReason: "error",
                },
                { content: [{ text: "FORBIDDEN_TOOL_CALL_REPLAY", type: "text" }] },
            ],
        });
        running.add(gym);

        submit(gym, "Do not replay a tool call from an incomplete response.");

        const failed = await gym.terminal.waitForText("WebSocket error", 30_000);
        expect(failed.text).not.toContain("FORBIDDEN_TOOL_CALL_REPLAY");
        expect(agentRequests(gym)).toHaveLength(1);
        await expect(gym.readFile("streamed-tool.txt")).rejects.toThrow();
    }, 120_000);

    it("does not retry after text follows a completed mutating tool", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf 'mutation\\n' >> mutation-runs.txt" },
                                id: "mutate-once-before-partial-response",
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
                        content: [{ text: "TEXT_AFTER_MUTATION", type: "text" }],
                        errorMessage: "WebSocket error",
                        stopReason: "error",
                    };
                }
                return { content: [{ text: "FORBIDDEN_MUTATION_REPLAY", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Mutate once and do not replay a partial continuation.");

        const failed = await gym.terminal.waitForText("WebSocket error", 30_000);
        expect(failed.text).toContain("TEXT_AFTER_MUTATION");
        expect(failed.text).not.toContain("FORBIDDEN_MUTATION_REPLAY");
        expect(agentRequests(gym)).toHaveLength(2);
        expect(await gym.readFile("mutation-runs.txt")).toBe("mutation\n");
    }, 120_000);

    it("retries a zero-content continuation without rerunning its completed tool", async () => {
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
                return {
                    content: [{ text: "ZERO_CONTENT_CONTINUATION_RECOVERED", type: "text" }],
                };
            },
        });
        running.add(gym);

        submit(gym, "Run the tool and recover if its continuation transport fails.");

        const completed = await gym.terminal.waitForText(
            "ZERO_CONTENT_CONTINUATION_RECOVERED",
            30_000,
        );
        expect(completed.text).not.toContain("Error WebSocket error");
        expect(await gym.readFile("tool-runs.txt")).toBe("tool-ran\n");
        expect(agentRequests(gym)).toHaveLength(3);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function agentRequests(gym: Gym): Gym["inference"]["requests"] {
    return gym.inference.requests.filter(
        (request) => request.options.sessionId?.endsWith(":title") !== true,
    );
}

async function captureProof(gym: Gym, fileName: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, fileName));
}
