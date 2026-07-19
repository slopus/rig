import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("user question across a daemon restart", () => {
    it("keeps waiting and continues the original run after the answer", async () => {
        const gym = await createGym({
            entrypoint: [
                "bash",
                "-lc",
                [
                    "node /app/packages/rig/dist/main.js",
                    "node /app/packages/rig/dist/main.js daemon start",
                    "echo DURABLE_QUESTION_RESUMED",
                    "exec node /app/packages/rig/dist/main.js resume --last",
                ].join("; "),
            ],
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                questions: [
                                    {
                                        header: "Database",
                                        id: "database",
                                        options: [
                                            {
                                                description: "Use the existing relational stack.",
                                                label: "PostgreSQL",
                                            },
                                            {
                                                description: "Keep local setup lightweight.",
                                                label: "SQLite",
                                            },
                                        ],
                                        question: "Which database should survive the restart?",
                                    },
                                ],
                            },
                            id: "restart-question",
                            name: "request_user_input",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [{ text: "DURABLE_QUESTION_COMPLETED", type: "text" }],
                },
            ],
            mode: "docker",
        });
        running.add(gym);

        gym.terminal.type("Choose a database across a daemon restart.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Which database should survive the restart?", 30_000);

        await gym.runInContainer("node", ["/app/packages/rig/dist/main.js", "daemon", "stop"]);
        await gym.runInContainer(
            "sh",
            [
                "-c",
                "while node /app/packages/rig/dist/main.js daemon status | grep -q 'Daemon is running'; do sleep 0.05; done",
            ],
            { timeoutMs: 30_000 },
        );
        await gym.runInContainer("node", ["/app/packages/rig/dist/main.js", "daemon", "start"]);
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Resumed") &&
                snapshot.text.includes("Which database should survive the restart?"),
            "the pending question in the reconnected client",
            30_000,
        );
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitForText("DURABLE_QUESTION_COMPLETED", 30_000);
        expect(completed.text).toContain("DURABLE_QUESTION_COMPLETED");
        const requests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(requests).toHaveLength(2);
        expect(requests[1]?.context.messages.at(-1)).toMatchObject({
            content: [
                {
                    text: '{"answers":{"database":{"answers":["PostgreSQL"]}}}',
                    type: "text",
                },
            ],
            isError: false,
            role: "toolResult",
            toolCallId: "restart-question",
            toolName: "request_user_input",
        });
    }, 120_000);
});
