import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("display settings persist when daemon config update fails", () => {
    it("writes the runtime config before reporting the socket failure", async () => {
        const gym = await createGym({
            files: {
                "break-daemon-config-socket.mjs": breakDaemonConfigSocketScript,
            },
            inference: [
                {
                    content: [
                        {
                            arguments: { cmd: "node break-daemon-config-socket.mjs" },
                            id: "break-daemon-config-socket",
                            name: "exec_command",
                            type: "toolCall",
                        },
                    ],
                },
                { content: [{ text: "The daemon config socket is unavailable.", type: "text" }] },
            ],
        });
        running.add(gym);

        gym.terminal.type("Prepare the daemon config failure test.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("The daemon config socket is unavailable.", 30_000);

        gym.terminal.type("/configure");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Show reasoning");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Could not update the config file.");

        const runtimeConfig = await gym.readFile("runtime-after-daemon-failure.toml");
        expect(runtimeConfig).toContain("show_reasoning = true");
    }, 120_000);
});

const breakDaemonConfigSocketScript = String.raw`
import { mkdir, rm, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const runtimePath = join(homedir(), ".rig", "runtime.toml");
await mkdir(dirname(runtimePath), { recursive: true });
await rm(runtimePath, { force: true });
await symlink("/workspace/runtime-after-daemon-failure.toml", runtimePath);

const socketPath = "/tmp/rig-" + process.getuid() + "/server.sock";
await unlink(socketPath);
`;
