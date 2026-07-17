import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("session blocked for user input chimes", () => {
    it("chimes when the question tool waits for an answer", async () => {
        const gym = await createGym({
            homeFiles: {
                ".rig/config.toml": "[settings]\ncompletion_chime = true\n",
            },
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
                            id: "question-chime",
                            name: "request_user_input",
                            type: "toolCall",
                        },
                    ],
                },
            ],
        });
        running.add(gym);
        let rawOutput = "";
        gym.terminal.onOutput((data) => {
            rawOutput += data;
        });

        submit(gym, "Choose a database.");
        await gym.terminal.waitForText("Which database should this service use?");

        expect(standaloneBellCount(rawOutput)).toBe(1);
    }, 120_000);

    it("chimes when an Auto permission request waits for approval", async () => {
        const gym = await createGym({
            homeFiles: {
                ".rig/config.toml": "[settings]\ncompletion_chime = true\n",
            },
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "ask",
                                    reason: "This action writes outside the workspace.",
                                    risk: "high",
                                    user_authorization: "low",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(0);
                return {
                    content: [
                        {
                            arguments: {
                                cmd: "printf 'blocked for approval\\n' > /home/rig/chime.txt",
                                justification: "Write outside the workspace.",
                                sandbox_permissions: "require_escalated",
                            },
                            id: "permission-chime",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                };
            },
            permissionMode: "auto",
        });
        running.add(gym);
        let rawOutput = "";
        gym.terminal.onOutput((data) => {
            rawOutput += data;
        });

        submit(gym, "Ask before writing outside the workspace.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("Deny") &&
                snapshot.text.includes("Waiting for approval"),
            "the permission request",
            30_000,
        );

        expect(standaloneBellCount(rawOutput)).toBe(1);
    }, 120_000);
});

function standaloneBellCount(output: string): number {
    let bells = 0;
    let inOsc = false;
    for (let index = 0; index < output.length; index += 1) {
        const character = output[index];
        if (character === "\x1b" && output[index + 1] === "]") {
            inOsc = true;
            index += 1;
            continue;
        }
        if (character === "\x07") {
            if (!inOsc) bells += 1;
            inOsc = false;
            continue;
        }
        if (inOsc && character === "\x1b" && output[index + 1] === "\\") {
            inOsc = false;
            index += 1;
        }
    }
    return bells;
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
