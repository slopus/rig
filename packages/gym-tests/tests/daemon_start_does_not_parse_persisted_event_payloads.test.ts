import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const RESTARTED_MARKER = "DAEMON_STARTED_WITH_UNREADABLE_EVENT_PAYLOAD";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("daemon startup with persisted event history", () => {
    it("opens the socket without parsing persisted event payloads", async () => {
        const gym = await createGym({
            entrypoint: ["bash", "/workspace/restart-with-unreadable-event.sh"],
            files: {
                "corrupt-persisted-event.mjs": corruptPersistedEventScript,
                "restart-with-unreadable-event.sh": restartWithUnreadableEventScript,
            },
            inference: [],
        });
        running.add(gym);

        await gym.terminal.waitForText("Ask Rig to do anything", 30_000);
        gym.terminal.press("ctrlD");

        const restarted = await gym.terminal.waitForText(RESTARTED_MARKER, 30_000);
        expect(restarted.text).toContain("Daemon is running");
        expect(restarted.text).not.toContain("Unexpected end of JSON input");
    }, 120_000);
});

const corruptPersistedEventScript = String.raw`
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/home/rig/.local/state/rig/sessions.sqlite");
const event = database.prepare("SELECT seq FROM session_events ORDER BY seq LIMIT 1").get();
if (event === undefined) throw new Error("Expected a persisted session event.");
database.prepare("UPDATE session_events SET data_json = ? WHERE seq = ?").run("{", event.seq);
database.close();
`;

const restartWithUnreadableEventScript = String.raw`#!/usr/bin/env bash
set -euo pipefail

node /app/packages/rig/dist/main.js
node /app/packages/rig/dist/main.js daemon stop
while node /app/packages/rig/dist/main.js daemon status | grep -q 'Daemon is running'; do
    sleep 0.05
done
node /workspace/corrupt-persisted-event.mjs
node /app/packages/rig/dist/main.js daemon start
node /app/packages/rig/dist/main.js daemon status
echo ${RESTARTED_MARKER}
`;
