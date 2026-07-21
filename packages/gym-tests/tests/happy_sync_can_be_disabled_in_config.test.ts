import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Happy configuration", () => {
    it("keeps synchronization disabled when the machine config turns it off", async () => {
        const gym = await createGym({
            homeFiles: {
                ".happy/access.key": JSON.stringify({
                    secret: Buffer.alloc(32, 7).toString("base64"),
                    token: "happy-gym-token",
                }),
                ".rig/config.toml": "[settings]\nhappy_integration = false\n",
            },
            inference: [
                {
                    content: [{ text: "Local-only session completed.", type: "text" }],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Work without Happy synchronization.");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Local-only session completed.", 30_000);

        const inspection = await gym.runInContainer("node", [
            "-e",
            [
                'const fs=require("node:fs")',
                'const {DatabaseSync}=require("node:sqlite")',
                'const db=new DatabaseSync("/home/rig/.server/sessions.sqlite")',
                'const sessions=db.prepare("select count(*) as count from happy_sessions").get().count',
                "db.close()",
                'const copied=fs.existsSync("/home/rig/.rig/happy/access.key")',
                "process.stdout.write(JSON.stringify({copied,sessions}))",
            ].join(";"),
        ]);

        expect(JSON.parse(inspection.stdout)).toEqual({ copied: false, sessions: 0 });
    }, 120_000);
});
