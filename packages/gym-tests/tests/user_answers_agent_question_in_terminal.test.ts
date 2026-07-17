import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("user answers an agent question in the terminal", () => {
    it("returns the selected answer to the next mocked inference", async () => {
        const gym = await createGym({
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
                                        question: "Which database should this service use?",
                                    },
                                ],
                            },
                            id: "question-1",
                            name: "request_user_input",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [{ text: "Selected PostgreSQL.", type: "text" }],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Choose a database.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Which database should this service use?");
        gym.terminal.press("enter");

        await gym.terminal.waitForText("Selected PostgreSQL.");
        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests[1]?.context.messages.at(-1)).toMatchObject({
            content: [
                {
                    text: '{"answers":{"database":{"answers":["PostgreSQL"]}}}',
                    type: "text",
                },
            ],
            isError: false,
            role: "toolResult",
            toolName: "request_user_input",
        });
    });
});
