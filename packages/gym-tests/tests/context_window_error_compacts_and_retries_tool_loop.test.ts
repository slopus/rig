import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const CONTEXT_ERROR =
    "Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.";
const HISTORY_PROMPT = "Load the history fixture into context.";
const RETRY_PROMPT = "Continue by checking the current step.";
const RECOVERED = "Recovered after compacting the tool-loop context.";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("context-window recovery during a tool loop", () => {
    it("compacts older context and retries without exposing the provider rejection", async () => {
        const gym = await createGym({
            files: {
                "history.txt": `HISTORY_FIXTURE_SENTINEL\n${"x".repeat(120_000)}\n`,
            },
            inference(request, callIndex) {
                const context = JSON.stringify(request.context.messages);
                const lastMessage = JSON.stringify(request.context.messages.at(-1));
                const isCompaction = request.context.systemPrompt?.startsWith(
                    "Create a detailed continuation brief",
                );

                if (callIndex === 0) {
                    expect(lastMessage).toContain(HISTORY_PROMPT);
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "cat history.txt",
                                    max_output_tokens: 40_000,
                                    workdir: "/workspace",
                                    yield_time_ms: 10_000,
                                },
                                id: "call-load-history",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toContain("HISTORY_FIXTURE_SENTINEL");
                    return { content: [{ text: "History loaded.", type: "text" }] };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toContain(RETRY_PROMPT);
                    expect(request.options.thinking).toBe("off");
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf 'current-step-ready\\n'",
                                    workdir: "/workspace",
                                    yield_time_ms: 10_000,
                                },
                                id: "call-current-step",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 3) {
                    expect(lastMessage).toContain("current-step-ready");
                    return {
                        content: [],
                        errorMessage: CONTEXT_ERROR,
                        stopReason: "error",
                    };
                }

                if (callIndex === 4) {
                    expect(isCompaction).toBe(true);
                    expect(request.context.tools).toEqual([]);
                    expect(request.options.thinking).toBe("off");
                    expect(context).toContain("HISTORY_FIXTURE_SENTINEL");
                    return {
                        content: [
                            {
                                text: "The earlier fixture inspection is complete.",
                                type: "text",
                            },
                        ],
                    };
                }

                if (callIndex === 5) {
                    expect(isCompaction).toBe(false);
                    expect(context).toContain("The earlier fixture inspection is complete.");
                    expect(context).toContain(RETRY_PROMPT);
                    expect(context).toContain("current-step-ready");
                    return { content: [{ text: RECOVERED, type: "text" }] };
                }

                throw new Error(`Unexpected agent inference call ${String(callIndex)}.`);
            },
            timeoutMs: 30_000,
        });
        running.add(gym);

        submit(gym, HISTORY_PROMPT);
        await gym.terminal.waitForText("History loaded.", 30_000);

        submit(gym, RETRY_PROMPT);
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes(RECOVERED) ||
                snapshot.text.includes("Your input exceeds the context window"),
            "transparent recovery or the context-window regression",
            30_000,
        );

        expect(outcome.text).toContain(RECOVERED);
        expect(outcome.text).not.toContain("Your input exceeds the context window");
        expect(agentRequests(gym)).toHaveLength(6);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function agentRequests(gym: Gym) {
    return gym.inference.requests.filter(
        (request) => request.options.sessionId?.endsWith(":title") !== true,
    );
}
