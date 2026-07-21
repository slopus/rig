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

        const reconnecting = await gym.terminal.waitForText("Reconnecting · 1 of 5", 30_000);
        expect(reconnecting.text).not.toContain("Error fetch failed");
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

    it("continues from streamed text without replaying its visible prefix", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [{ text: "PARTIAL_UNSENT_SUFFIX", type: "text" }],
                        disconnectAfterTextDeltas: 1,
                        textDeltaChunkSize: 8,
                    };
                }
                expect(request.context.messages.at(-1)).toMatchObject({
                    content: [{ text: "PARTIAL_", type: "text" }],
                    role: "assistant",
                });
                return { content: [{ text: "CONTINUED_AFTER_PREFIX", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Continue after a transport failure without replaying text.");

        const completed = await gym.terminal.waitForText("CONTINUED_AFTER_PREFIX", 30_000);
        expect(completed.text).not.toContain("WebSocket error");
        expect(occurrences(completed.text, "PARTIAL_")).toBe(1);
        expect(agentRequests(gym)).toHaveLength(2);
    }, 120_000);

    it("continues after a streamed tool call without executing the incomplete call", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
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
                    };
                }
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: true,
                    role: "toolResult",
                    toolCallId: "streamed-before-failure",
                });
                return { content: [{ text: "TOOL_CALL_CRASH_RECOVERED", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Recover after an incomplete tool call without running it.");

        const completed = await gym.terminal.waitForText("TOOL_CALL_CRASH_RECOVERED", 30_000);
        expect(completed.text).not.toContain("WebSocket error");
        expect(agentRequests(gym)).toHaveLength(2);
        await expect(gym.readFile("streamed-tool.txt")).rejects.toThrow();
    }, 120_000);

    it("continues after text follows a completed mutating tool without rerunning it", async () => {
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
                if (callIndex === 1) {
                    expect(request.context.messages.at(-1)).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [{ text: "TEXT_AFTER_MUTATION_UNSENT", type: "text" }],
                        errorAfterTextDeltas: 1,
                        errorMessage: "WebSocket error",
                        stopReason: "error",
                        textDeltaChunkSize: 19,
                    };
                }
                expect(request.context.messages.at(-1)).toMatchObject({
                    content: [{ text: "TEXT_AFTER_MUTATION", type: "text" }],
                    role: "assistant",
                });
                return { content: [{ text: "MUTATION_CONTINUED", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Mutate once and continue a partial response after a crash.");

        const completed = await gym.terminal.waitForText("MUTATION_CONTINUED", 30_000);
        expect(completed.text).not.toContain("WebSocket error");
        expect(occurrences(completed.text, "TEXT_AFTER_MUTATION")).toBe(1);
        expect(agentRequests(gym)).toHaveLength(3);
        expect(await gym.readFile("mutation-runs.txt")).toBe("mutation\n");
    }, 120_000);

    it("gives Claude an internal continuation turn that never reaches the TUI", async () => {
        const gym = await createGym({
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [{ text: "CLAUDE_PARTIAL_UNSENT", type: "text" }],
                        errorAfterTextDeltas: 1,
                        errorMessage: "WebSocket error",
                        stopReason: "error",
                        textDeltaChunkSize: 15,
                    };
                }
                expect(request.context.messages.at(-2)).toMatchObject({
                    content: [{ text: "CLAUDE_PARTIAL_", type: "text" }],
                    role: "assistant",
                });
                expect(request.context.messages.at(-1)).toMatchObject({
                    content: [{ text: "Continue after the inference crash.", type: "text" }],
                    role: "user",
                });
                return { content: [{ text: "CLAUDE_CONTINUED", type: "text" }] };
            },
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        submit(gym, "Recover Claude without exposing an invented user turn.");

        const completed = await gym.terminal.waitForText("CLAUDE_CONTINUED", 30_000);
        expect(completed.text).not.toContain("Continue after the inference crash.");
        expect(completed.text).not.toContain("WebSocket error");
        expect(occurrences(completed.text, "CLAUDE_PARTIAL")).toBe(1);
        expect(agentRequests(gym)).toHaveLength(2);
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

    it("retries when a continuation opens an empty content block before disconnecting", async () => {
        const gym = await createGym({
            inference(request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: "printf 'tool-ran\\n' >> marker-tool-runs.txt" },
                                id: "run-once-before-empty-content-marker",
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
                        content: [{ text: "", type: "text" }],
                        errorAfterContentStart: true,
                        errorMessage: "WebSocket error",
                        stopReason: "error",
                    };
                }
                expect(callIndex).toBe(2);
                return {
                    content: [{ text: "EMPTY_CONTENT_MARKER_RECOVERED", type: "text" }],
                };
            },
        });
        running.add(gym);

        submit(gym, "Run the tool and recover from an empty streamed content marker.");

        const completedOrFailed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("EMPTY_CONTENT_MARKER_RECOVERED") ||
                snapshot.text.includes("WebSocket error"),
            "recovery or terminal transport failure",
            30_000,
        );
        expect(completedOrFailed.text).toContain("EMPTY_CONTENT_MARKER_RECOVERED");
        expect(completedOrFailed.text).not.toContain("Error WebSocket error");
        expect(await gym.readFile("marker-tool-runs.txt")).toBe("tool-ran\n");
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

function occurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

async function captureProof(gym: Gym, fileName: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, fileName));
}
