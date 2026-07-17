import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("starting Rig after its development code changes", () => {
    it("asks before replacing the daemon in the current workspace", async () => {
        const cliPath = "/app/packages/rig/dist/main.js";
        const setup = [
            "mkdir -p /tmp/rig-workspace-daemon",
            "ln -s /tmp/rig-workspace-daemon /workspace/.rig-dev",
            "export RIG_SERVER_DIRECTORY=/workspace/.rig-dev",
            `RIG_DEVELOPMENT_BUILD_ID=older-source node ${cliPath} daemon start`,
            `RIG_DEVELOPMENT_BUILD_ID=current-source exec node ${cliPath}`,
        ].join("\n");
        const gym = await createGym({
            entrypoint: ["/bin/sh", "-lc", setup],
            inference: [],
            startupText: "Restart local daemon?",
        });
        running.add(gym);

        const prompt = await gym.terminal.snapshot();
        expect(prompt.text).toContain("development code changed");
        expect(prompt.text).toContain("/workspace/.rig-dev/server.sock");
        expect(prompt.text).not.toContain("older-source");
        expect(prompt.text).not.toContain("current-source");

        gym.terminal.press("enter");

        await gym.terminal.waitForText("Ask Rig to do anything", 20_000);
    });
});
