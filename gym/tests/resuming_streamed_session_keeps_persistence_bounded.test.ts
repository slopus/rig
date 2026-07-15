import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const artifacts = resolve(import.meta.dirname, "../../artifacts/bounded-session-events");
const running = new Set<Gym>();
const RESUME_MARKER = "STREAMED_SESSION_RESUME_BOUNDARY";
const FIRST_RESPONSE = `STREAMED_HISTORY_START\n${"streamed history ".repeat(64)}\nSTREAMED_HISTORY_COMPLETE`;
const MAX_PERSISTED_EVENT_ROWS = 16;

beforeAll(async () => {
    await mkdir(artifacts, { recursive: true });
});

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("resuming a session with streamed response history", () => {
    it("keeps transient inference events out of durable storage and resumes the transcript", async () => {
        const gym = await createGym({
            cols: 96,
            entrypoint: [
                "bash",
                "-lc",
                [
                    "node /app/packages/rig/dist/main.js",
                    "node /app/packages/rig/dist/main.js daemon stop",
                    "node /workspace/inspect-streamed-session.mjs",
                    `echo ${RESUME_MARKER}`,
                    "exec node /app/packages/rig/dist/main.js resume --last",
                ].join("; "),
            ],
            files: {
                "inspect-streamed-session.mjs": inspectStreamedSessionScript,
            },
            inference(_request, callIndex) {
                if (callIndex === 0) {
                    return {
                        content: [{ text: FIRST_RESPONSE, type: "text" }],
                        textDeltaChunkSize: 1,
                    };
                }
                expect(callIndex).toBe(1);
                return { content: [{ text: "FOLLOW_UP_AFTER_RESUME", type: "text" }] };
            },
            rows: 60,
        });
        running.add(gym);

        submit(gym, "Stream a response, then let me resume this session.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("STREAMED_HISTORY_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the streamed response to complete",
            30_000,
        );

        gym.terminal.press("ctrlD");
        const resumed = await gym.terminal.waitUntil(
            (snapshot) => {
                const marker = snapshot.text.indexOf(RESUME_MARKER);
                if (marker < 0) return false;
                const resumedText = snapshot.text.slice(marker);
                return (
                    resumedText.includes("STREAMED_HISTORY_COMPLETE") &&
                    resumedText.includes("Ask Rig to do anything")
                );
            },
            "the streamed transcript after daemon restart",
            30_000,
        );
        expect(resumed.text.slice(resumed.text.indexOf(RESUME_MARKER))).toContain(
            "STREAMED_HISTORY_START",
        );

        const persistedJson = await gym.readFile("streamed-session-persistence.json");
        const persisted = JSON.parse(persistedJson) as {
            persistedEventRows: number;
            transientInferenceEvents: number;
        };
        expect(persisted.transientInferenceEvents).toBe(0);
        expect(persisted.persistedEventRows).toBeGreaterThan(0);
        expect(persisted.persistedEventRows).toBeLessThanOrEqual(MAX_PERSISTED_EVENT_ROWS);

        submit(gym, "Confirm this resumed session still works.");
        const healthy = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("FOLLOW_UP_AFTER_RESUME") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "a completed turn after resume",
            30_000,
        );
        expect(healthy.cursor.x).toBeLessThan(96);
        expect(healthy.cursor.y).toBeLessThan(60);

        await writeFile(`${artifacts}/persistence.json`, `${persistedJson}\n`);
        await gym.terminal.screenshot(`${artifacts}/healthy-resume.png`);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

const inspectStreamedSessionScript = `
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const transientTypes = new Set([
    "start",
    "text_start",
    "text_delta",
    "text_end",
    "thinking_start",
    "thinking_delta",
    "thinking_end",
    "toolcall_start",
    "toolcall_delta",
    "toolcall_end",
    "done",
    "error",
]);
const database = new DatabaseSync("/home/rig/.local/state/rig/sessions.sqlite", { readOnly: true });
const sessionId = database
    .prepare("SELECT id FROM sessions WHERE parent_session_id IS NULL ORDER BY created_at_ms DESC LIMIT 1")
    .get().id;
const rows = database
    .prepare("SELECT type, data_json FROM session_events WHERE session_id = ? ORDER BY seq")
    .all(sessionId);
let transientInferenceEvents = 0;
for (const row of rows) {
    if (row.type !== "agent_event") continue;
    const event = JSON.parse(row.data_json).event;
    if (transientTypes.has(event?.type)) transientInferenceEvents += 1;
}
database.close();
writeFileSync(
    "/workspace/streamed-session-persistence.json",
    JSON.stringify({ persistedEventRows: rows.length, transientInferenceEvents }),
);
`;
