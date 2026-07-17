import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Workspace write executable search paths", () => {
    it("runs a user-installed tool outside the workspace", async () => {
        let stage = 0;
        const gym = await createGym({
            environment: {
                PATH: "/home/rig/developer-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            },
            homeFiles: {
                "developer-bin/rig-dev-tool": {
                    content: "#!/bin/sh\nprintf 'DEVELOPER_TOOL_PATH_OK\\n'\n",
                    mode: 0o755,
                },
            },
            inference(request) {
                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    return {
                        content: [
                            {
                                arguments: { cmd: "rig-dev-tool" },
                                id: "run-user-installed-tool",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(lastMessage).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "exec_command",
                });
                expect(JSON.stringify(lastMessage)).toContain("DEVELOPER_TOOL_PATH_OK");
                return { content: [{ text: "USER_TOOL_PATH_VERIFIED", type: "text" }] };
            },
            permissionMode: "workspace_write",
        });
        running.add(gym);

        gym.terminal.type("Run the user-installed developer tool.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("USER_TOOL_PATH_VERIFIED", 30_000);
    }, 120_000);
});
