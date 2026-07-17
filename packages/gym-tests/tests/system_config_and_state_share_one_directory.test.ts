import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("system config and durable state share one directory", () => {
    it("keeps the session database beside user config and daemon files temporary", async () => {
        const gym = await createGym({
            homeFiles: {
                ".rig/config.toml": "[settings]\nshow_usage = false\n",
            },
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: [
                                    "directory=/home/rig/.rig",
                                    'test -f "$directory/config.toml"',
                                    'test -f "$directory/sessions.sqlite"',
                                    'test -S "/tmp/rig-$(id -u)/server.sock"',
                                    'test ! -e "/home/rig/.local/state/rig/sessions.sqlite"',
                                    "printf 'Rig durable files are together.\\n'",
                                ].join(" && "),
                            },
                            id: "verify-rig-directory",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            text: "Verified the unified durable Rig directory.",
                            type: "text",
                        },
                    ],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Verify Rig's durable system file locations.");
        gym.terminal.press("enter");

        const snapshot = await gym.terminal.waitForText(
            "Verified the unified durable Rig directory.",
            30_000,
        );
        expect(snapshot.text).toContain("Rig durable files are together.");

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests[1]?.context.messages.at(-1)).toMatchObject({
            isError: false,
            role: "toolResult",
            toolName: "exec_command",
        });
    });

    it("uses RIG_HOME as the single durable directory override", async () => {
        const gym = await createGym({
            environment: { RIG_HOME: "/home/rig/custom-rig-home" },
            homeFiles: {
                "custom-rig-home/config.toml": "[settings]\nshow_usage = false\n",
            },
            inference: [
                {
                    content: [
                        {
                            arguments: {
                                cmd: [
                                    "directory=/home/rig/custom-rig-home",
                                    'test -f "$directory/config.toml"',
                                    'test -f "$directory/sessions.sqlite"',
                                    'test ! -e "/home/rig/.rig/sessions.sqlite"',
                                    "printf 'RIG_HOME controls durable files.\\n'",
                                ].join(" && "),
                            },
                            id: "verify-custom-rig-home",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                {
                    content: [
                        {
                            text: "Verified the custom Rig home.",
                            type: "text",
                        },
                    ],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Verify the custom Rig home.");
        gym.terminal.press("enter");

        const snapshot = await gym.terminal.waitForText("Verified the custom Rig home.", 30_000);
        expect(snapshot.text).toContain("RIG_HOME controls durable files.");
    });
});
