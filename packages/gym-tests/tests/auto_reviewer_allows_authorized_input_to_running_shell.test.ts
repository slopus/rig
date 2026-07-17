import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto reviewer allows authorized input to a running shell", () => {
    it("keeps shell startup sandboxed and reviews input without a redundant prompt", async () => {
        let sessionId: number | undefined;
        const gym = await createGym({
            cols: 104,
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The user explicitly requested this interactive shell action.",
                                    risk: "low",
                                    user_authorization: "high",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "IFS= read -r value; printf '%s\\n' \"$value\" > interactive-result.txt",
                                    workdir: "/workspace",
                                    yield_time_ms: 500,
                                },
                                id: "start-authorized-interactive-shell",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (callIndex === 1) {
                    const text = messageText(request.context.messages.at(-1));
                    const match = text.match(/Process running with session ID (\d+)/u);
                    sessionId = Number(match?.[1]);
                    expect(sessionId).toBeGreaterThan(0);
                    return {
                        content: [
                            {
                                arguments: { chars: "approved input\n", session_id: sessionId },
                                id: "send-authorized-interactive-input",
                                name: "write_stdin",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(3);
                return { content: [{ text: "AUTO_INTERACTIVE_INPUT_COMPLETE", type: "text" }] };
            },
            permissionMode: "auto",
            rows: 30,
        });
        running.add(gym);

        submit(gym, "Start the interactive command and send it the requested input.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("AUTO_INTERACTIVE_INPUT_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "reviewer-approved interactive input",
            30_000,
        );

        await expect(gym.readFile("interactive-result.txt")).resolves.toBe("approved input\n");
        expect(completed.text).not.toContain("Approved automatically");
        expect(completed.text).not.toContain("Allow once");
        expect(completed.text).not.toContain("Waiting for approval");
        const reviewRequests = gym.inference.requests.filter((request) =>
            request.context.systemPrompt?.includes("independent permission reviewer"),
        );
        expect(reviewRequests).toHaveLength(1);
        expect(messageText(reviewRequests[0]?.context.messages.at(-1))).toContain(
            '"tool":"write_stdin"',
        );
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function messageText(message: { content: unknown } | undefined): string {
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
