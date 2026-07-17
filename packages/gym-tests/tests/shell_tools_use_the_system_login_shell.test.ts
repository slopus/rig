import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("shell tool command interpreter", () => {
    it("uses the system login shell and its executable search path", async () => {
        let stage = 0;
        const gym = await createGym({
            environment: {
                PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                SHELL: "/home/rig/system-shell",
            },
            homeFiles: {
                ".bash_profile": 'export PATH="$HOME/login-bin:$PATH"\n',
                "login-bin/login-tool": {
                    content: "#!/bin/sh\nprintf LOGIN_PATH_OK\n",
                    mode: 0o755,
                },
                "system-shell": {
                    content: '#!/bin/sh\nexport SYSTEM_SHELL_USED=1\nexec /bin/bash "$@"\n',
                    mode: 0o755,
                },
            },
            inference(request) {
                if (stage === 0) {
                    stage = 1;
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: '[[ "$SYSTEM_SHELL_USED" == 1 ]] && login-tool',
                                },
                                id: "verify-system-login-shell",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                const result = request.context.messages.at(-1);
                expect(result).toMatchObject({
                    isError: false,
                    role: "toolResult",
                    toolName: "exec_command",
                });
                expect(JSON.stringify(result)).toContain("LOGIN_PATH_OK");
                return { content: [{ text: "LOGIN_SHELL_VERIFIED", type: "text" }] };
            },
        });
        running.add(gym);

        gym.terminal.type("Verify the login shell and its tool path.");
        gym.terminal.press("enter");

        await gym.terminal.waitForText("LOGIN_SHELL_VERIFIED", 30_000);
    }, 120_000);
});
