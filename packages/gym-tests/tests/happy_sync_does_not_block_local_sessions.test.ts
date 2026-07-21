import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Happy mobile synchronization", () => {
    it("imports Happy credentials and durably queues an open session while offline", async () => {
        const credentials = {
            secret: Buffer.alloc(32, 7).toString("base64"),
            token: "happy-gym-token",
        };
        const gym = await createGym({
            homeFiles: {
                ".happy/access.key": JSON.stringify(credentials),
                ".happy/settings.json": JSON.stringify({ serverUrl: "http://127.0.0.1:9" }),
            },
            inference: [
                {
                    content: [
                        {
                            text: "Local work continued while Happy was offline.",
                            type: "text",
                        },
                    ],
                },
            ],
        });
        running.add(gym);

        gym.terminal.type("Keep working even if mobile sync is unavailable.");
        gym.terminal.press("enter");

        await gym.terminal.waitForText("Local work continued while Happy was offline.", 30_000);
        const inspection = await gym.runInContainer("node", [
            "-e",
            [
                'const fs=require("node:fs")',
                'const {DatabaseSync}=require("node:sqlite")',
                'const copied=JSON.parse(fs.readFileSync("/home/rig/.rig/happy/access.key","utf8"))',
                'const mode=fs.statSync("/home/rig/.rig/happy/access.key").mode & 0o777',
                'const db=new DatabaseSync("/home/rig/.server/sessions.sqlite")',
                'const sessions=db.prepare("select count(*) as count from happy_sessions").get().count',
                'const outbox=db.prepare("select count(*) as count from happy_outbox").get().count',
                "db.close()",
                "process.stdout.write(JSON.stringify({copied,mode,sessions,outbox}))",
            ].join(";"),
        ]);
        const state = JSON.parse(inspection.stdout) as {
            copied: typeof credentials;
            mode: number;
            outbox: number;
            sessions: number;
        };

        expect(state.copied).toEqual(credentials);
        expect(state.mode).toBe(0o600);
        expect(state.sessions).toBe(1);
        expect(state.outbox).toBeGreaterThan(0);
    }, 120_000);
});
