import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto permission approval across a daemon restart", () => {
    it("keeps waiting and executes the reviewed tool only after approval", async () => {
        const gym = await createGym({
            entrypoint: [
                "bash",
                "-lc",
                [
                    "node /app/packages/rig/dist/main.js",
                    "node /app/packages/rig/dist/main.js daemon start",
                    "echo DURABLE_PERMISSION_RESUMED",
                    "exec node /app/packages/rig/dist/main.js resume --last",
                ].join("; "),
            ],
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "ask",
                                    reason: "The command writes outside the workspace.",
                                    risk: "high",
                                    user_authorization: "low",
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
                                    cmd: "printf 'approved after restart\\n' > /home/rig/durable-permission.txt",
                                    justification: "Verify durable permission approval.",
                                    sandbox_permissions: "require_escalated",
                                },
                                id: "restart-permission",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(2);
                expect(request.context.messages.at(-1)).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolCallId: "restart-permission",
                    toolName: "exec_command",
                });
                return {
                    content: [{ text: "DURABLE_PERMISSION_COMPLETED", type: "text" }],
                };
            },
            mode: "docker",
            permissionMode: "auto",
        });
        running.add(gym);

        gym.terminal.type("Write the reviewed file after a daemon restart.");
        gym.terminal.press("enter");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("The command writes outside the workspace."),
            "the permission request",
            30_000,
        );

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
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("The command writes outside the workspace."),
            "the permission request in the reconnected client",
            30_000,
        );
        gym.terminal.press("enter");

        await gym.terminal.waitForText("DURABLE_PERMISSION_COMPLETED", 30_000);
        const inspected = await gym.runInContainer("sh", [
            "-c",
            "test \"$(cat /home/rig/durable-permission.txt)\" = 'approved after restart'",
        ]);
        expect(inspected.stderr).toBe("");
        const requests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(requests).toHaveLength(3);
    }, 120_000);
});
