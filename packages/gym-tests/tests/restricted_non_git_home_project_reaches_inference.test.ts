import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("restricted non-git home project", () => {
    it("reaches inference when ancestor marker paths are private", async () => {
        const gym = await createGym({
            entrypoint: [
                "/bin/sh",
                "-lc",
                "cd /home/rig/project && exec node /app/packages/rig/dist/main.js",
            ],
            homeFiles: {
                "project/README.md": "A project without a Git marker.\n",
            },
            inference: [
                {
                    content: [{ text: "The agent turn reached inference.", type: "text" }],
                },
            ],
            permissionMode: "workspace_write",
        });
        running.add(gym);

        gym.terminal.type("Confirm this project is available.");
        gym.terminal.press("enter");

        const screen = await gym.terminal.waitForText("The agent turn reached inference.", 30_000);
        expect(screen.text).toContain("The agent turn reached inference.");

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        expect(agentRequests).toHaveLength(1);
        expect(agentRequests[0]?.context.messages.at(-1)).toMatchObject({
            content: [{ text: "Confirm this project is available.", type: "text" }],
            role: "user",
        });
    });
});
