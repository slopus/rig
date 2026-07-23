import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("subagent live log", () => {
    it("shows the selected model and tails only the messages that fit the terminal", async () => {
        let parentSessionId: string | undefined;
        const childText = [
            "FIRST_LOG_LINE",
            ...Array.from({ length: 16 }, (_, index) => `log line ${index + 1}`),
            "LIVE_CHUNK_MARKER",
            ...Array.from({ length: 8 }, (_, index) => `tail line ${index + 1}`),
            "LAST_LOG_LINE",
        ].join("\n");
        const gym = await createGym({
            cols: 80,
            rows: 18,
            inference: (request) => {
                const sessionId = request.options.sessionId;
                const last = request.context.messages.at(-1);
                const text = messageText(last?.content);
                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    fork_turns: "none",
                                    message: "Stream a long inspection log.",
                                    task_name: "stream_log",
                                },
                                id: "spawn-stream-log",
                                name: "spawn_agent",
                                namespace: "collaboration",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (text.includes("Stream a long inspection log.")) {
                    return {
                        content: [{ text: childText, type: "text" }],
                        textDeltaChunkSize: 8,
                        textDeltaDelayMs: 20,
                        usage: {
                            cacheRead: 900,
                            cacheWrite: 0,
                            cost: {
                                cacheRead: 0,
                                cacheWrite: 0,
                                input: 0,
                                output: 0,
                                total: 0,
                            },
                            input: 100,
                            output: 250,
                            totalTokens: 1_250,
                        },
                    };
                }
                if (text.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_ACKNOWLEDGED_LOG", type: "text" }] };
                }
                return { content: [{ text: "PARENT_READY", type: "text" }] };
            },
        });
        running.add(gym);

        submit(gym, "Start a background streaming inspection.");
        await gym.terminal.waitForText("PARENT_READY", 30_000);
        submit(gym, "/agents");
        const list = await gym.terminal.waitForText("Enter to view log", 30_000);
        expect(list.text).toContain("Gym");
        expect(list.text).toContain("context tokens");

        gym.terminal.press("enter");
        await gym.terminal.waitForText("LIVE_CHUNK_MARKER", 30_000);
        const completed = await gym.terminal.waitForText("LAST_LOG_LINE", 30_000);

        expect(completed.rows).toHaveLength(18);
        expect(completed.text).toContain("LAST_LOG_LINE");
        expect(completed.text).not.toContain("FIRST_LOG_LINE");
        expect(completed.text).toContain("Gym");
        expect(completed.text).toContain("1.3k context tokens");
    }, 60_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
}
