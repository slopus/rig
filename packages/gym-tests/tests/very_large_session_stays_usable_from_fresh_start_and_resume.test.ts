import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const scale = readScale(process.env.RIG_GYM_HEAVY_SESSION_SCALE);
const fixtureShape = {
    contextMessages: scaledCount(150),
    semanticMessages: scaledEvenCount(820),
    transientEvents: scaledCount(40_000),
};

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("a very large historical session", () => {
    it("keeps both a fresh session and a cold-resumed heavy session usable", async () => {
        let agentCallCount = 0;
        let compactionCallCount = 0;
        const gym = await createGym({
            cols: 120,
            entrypoint: ["bash", "/workspace/run-heavy-session-gym.sh"],
            environment: {
                HEAVY_CONTEXT_MESSAGES: String(fixtureShape.contextMessages),
                HEAVY_SEMANTIC_MESSAGES: String(fixtureShape.semanticMessages),
                HEAVY_TRANSIENT_EVENTS: String(fixtureShape.transientEvents),
            },
            files: {
                "create-heavy-session.mjs": createHeavySessionScript,
                "run-heavy-session-gym.sh": {
                    content: runHeavySessionGymScript,
                    mode: 0o755,
                },
            },
            inference(request) {
                const latestMessage = request.context.messages.at(-1);
                const latestText =
                    latestMessage?.role === "user"
                        ? typeof latestMessage.content === "string"
                            ? latestMessage.content
                            : latestMessage.content
                                  .flatMap((block) => (block.type === "text" ? [block.text] : []))
                                  .join("")
                        : "";
                const isCompaction = latestText.startsWith("Create a detailed continuation brief");
                if (isCompaction === true) {
                    compactionCallCount += 1;
                    return {
                        content: [
                            {
                                text: "The historical session is healthy. Continue with the latest user request.",
                                type: "text",
                            },
                        ],
                    };
                }
                const lastUserMessage = [...request.context.messages]
                    .reverse()
                    .find((message) => message.role === "user");
                const agentCallIndex = agentCallCount;
                agentCallCount += 1;
                if (agentCallIndex === 0) {
                    expect(lastUserMessage).toMatchObject({ role: "user" });
                    return { content: [{ text: "FRESH_SESSION_ON_HEAVY_DB_OK", type: "text" }] };
                }
                expect(agentCallIndex).toBe(1);
                expect(lastUserMessage).toMatchObject({ role: "user" });
                return { content: [{ text: "RESUMED_HEAVY_SESSION_OK", type: "text" }] };
            },
            mode: "docker",
            rows: 60,
            timeoutMs: 180_000,
        });
        running.add(gym);

        const freshStartupMs = await elapsedSince(gym, "fresh-started-at-ms");
        submit(gym, "Verify a new session works beside a very large historical session.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("FRESH_SESSION_ON_HEAVY_DB_OK") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "a completed turn in the fresh session",
            30_000,
        );

        gym.terminal.press("ctrlD");
        await gym.terminal.waitForText("HEAVY_RESUME_STARTED", 30_000);
        const resumed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("HEAVY_LAST_ASSISTANT_MESSAGE") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the very large session transcript after a cold resume",
            180_000,
        );
        expect(resumed.text).not.toContain("JavaScript heap out of memory");
        const resumeStartupMs = await elapsedSince(gym, "resume-started-at-ms");

        submit(gym, "Verify this very large resumed session still accepts another turn.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("RESUMED_HEAVY_SESSION_OK") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "a completed turn after the very large session resumed",
            60_000,
        );
        expect(completed.text).not.toContain("socket hang up");

        const fixture = JSON.parse(await gym.readFile("heavy-session-fixture.json")) as {
            contextBytes: number;
            databaseBytes: number;
            eventBytes: number;
            eventRows: number;
            messageBytes: number;
            messageRows: number;
            sessionId: string;
        };
        expect(fixture.eventRows).toBe(
            fixtureShape.transientEvents + fixtureShape.semanticMessages + 1,
        );
        expect(fixture.messageRows).toBe(fixtureShape.semanticMessages);
        expect(fixture.contextBytes).toBeGreaterThan(
            Math.max(1, fixtureShape.contextMessages - 1) * 5_000,
        );
        expect(fixture.databaseBytes).toBeGreaterThan(fixture.eventBytes + fixture.messageBytes);
        if (scale === 1) {
            expect(fixture.databaseBytes).toBeGreaterThan(180_000_000);
            expect(fixture.databaseBytes).toBeLessThan(240_000_000);
        }
        expect(agentCallCount).toBe(2);
        console.info(
            "Very large session Gym metrics",
            JSON.stringify({ fixture, freshStartupMs, resumeStartupMs, scale }),
        );
    }, 360_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

async function elapsedSince(gym: Gym, path: string): Promise<number> {
    const startedAt = Number(await gym.readFile(path));
    return Date.now() - startedAt;
}

function readScale(value: string | undefined): number {
    if (value === undefined) return 1;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("RIG_GYM_HEAVY_SESSION_SCALE must be a positive number.");
    }
    return parsed;
}

function scaledCount(value: number): number {
    return Math.max(1, Math.round(value * scale));
}

function scaledEvenCount(value: number): number {
    const count = Math.max(2, Math.round(value * scale));
    return count % 2 === 0 ? count : count + 1;
}

const runHeavySessionGymScript = String.raw`#!/usr/bin/env bash
set -euo pipefail

node /workspace/create-heavy-session.mjs
node -e 'require("node:fs").writeFileSync("/workspace/fresh-started-at-ms", String(Date.now()))'
node /app/packages/rig/dist/main.js
node /app/packages/rig/dist/main.js daemon stop
node -e 'require("node:fs").writeFileSync("/workspace/resume-started-at-ms", String(Date.now()))'
echo HEAVY_RESUME_STARTED
exec node /app/packages/rig/dist/main.js resume "$(cat /workspace/heavy-session-id)"
`;

const createHeavySessionScript = String.raw`
import { writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { createEventIdFactory } from "/app/packages/rig/dist/protocol/index.js";
import { PersistentSessionStore } from "/app/packages/rig/dist/server/index.js";

const databasePath = "/home/rig/.rig/sessions.sqlite";
const semanticMessageCount = requiredEvenCount("HEAVY_SEMANTIC_MESSAGES");
const transientEventCount = requiredCount("HEAVY_TRANSIENT_EVENTS");
const contextMessageCount = Math.min(requiredCount("HEAVY_CONTEXT_MESSAGES"), semanticMessageCount);
const createdAt = Date.now() - 86_400_000;
const store = new PersistentSessionStore({ databasePath, now: () => createdAt });
const session = store.create({
    cwd: "/workspace",
    modelId: "openai/gym",
    permissionMode: "full_access",
    providerId: "gym",
});
const sessionId = session.id;
store.close();

const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY");
const sessionRow = database
    .prepare("SELECT last_event_id FROM sessions WHERE id = ?")
    .get(sessionId);
const createEventId = createEventIdFactory({
    after: sessionRow.last_event_id,
    now: () => createdAt + 1_000,
});
const insertEvent = database.prepare(
    "INSERT INTO session_events (session_id, event_id, type, created_at_ms, data_json) VALUES (?, ?, ?, ?, ?)",
);
const insertMessage = database.prepare(
    "INSERT INTO session_messages (session_id, position, message_id, role, is_partial, run_id, message_json, updated_at_ms) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
);
const transientPayload = JSON.stringify({
    event: {
        contentIndex: 0,
        delta: "x".repeat(4_200),
        type: "toolcall_delta",
    },
    runId: "legacy-heavy-run",
});
const messages = [];
let lastEventId = sessionRow.last_event_id;

database.exec("BEGIN IMMEDIATE");
try {
    for (let index = 0; index < transientEventCount; index += 1) {
        lastEventId = createEventId();
        insertEvent.run(
            sessionId,
            lastEventId,
            "agent_event",
            createdAt + index,
            transientPayload,
        );
    }

    for (let position = 0; position < semanticMessageCount; position += 1) {
        const turn = Math.floor(position / 2);
        const runId = "heavy-run-" + String(turn).padStart(6, "0");
        const isLast = position === semanticMessageCount - 1;
        const text = isLast
            ? "HEAVY_LAST_ASSISTANT_MESSAGE"
            : "history-" + String(position).padStart(6, "0") + " " + "m".repeat(5_450);
        const message =
            position % 2 === 0
                ? { blocks: [{ text, type: "text" }], id: "user-" + position, role: "user" }
                : { blocks: [{ text, type: "text" }], id: "agent-" + position, role: "agent" };
        messages.push(message);
        insertMessage.run(
            sessionId,
            position,
            message.id,
            message.role,
            runId,
            JSON.stringify(message),
            createdAt + transientEventCount + position,
        );
        lastEventId = createEventId();
        const data =
            message.role === "user"
                ? { delivery: "run", displayText: text, message, runId }
                : { message, runId };
        insertEvent.run(
            sessionId,
            lastEventId,
            message.role === "user" ? "message_submitted" : "agent_message",
            createdAt + transientEventCount + position,
            JSON.stringify(data),
        );
    }

    const contextMessages = messages.slice(-contextMessageCount);
    database
        .prepare(
            "UPDATE sessions SET status = 'completed', active_run_id = NULL, context_messages_json = ?, last_event_id = ?, last_message_at_ms = ?, title = ?, title_status = 'ready', recap = ?, updated_at_ms = ? WHERE id = ?",
        )
        .run(
            JSON.stringify(contextMessages),
            lastEventId,
            createdAt + transientEventCount + semanticMessageCount,
            "Very large historical Gym session",
            "A real-world-scale generated session used for startup and resume performance coverage.",
            createdAt + transientEventCount + semanticMessageCount,
            sessionId,
        );
    database.exec("COMMIT");
} catch (error) {
    database.exec("ROLLBACK");
    throw error;
}

const counts = database
    .prepare(
        "SELECT (SELECT COUNT(*) FROM session_events WHERE session_id = ?) AS eventRows, (SELECT COALESCE(SUM(LENGTH(data_json)), 0) FROM session_events WHERE session_id = ?) AS eventBytes, (SELECT COUNT(*) FROM session_messages WHERE session_id = ?) AS messageRows, (SELECT COALESCE(SUM(LENGTH(message_json)), 0) FROM session_messages WHERE session_id = ?) AS messageBytes, (SELECT LENGTH(context_messages_json) FROM sessions WHERE id = ?) AS contextBytes",
    )
    .get(sessionId, sessionId, sessionId, sessionId, sessionId);
database.close();
const databaseBytes = (await stat(databasePath)).size;
writeFileSync("/workspace/heavy-session-id", sessionId);
writeFileSync(
    "/workspace/heavy-session-fixture.json",
    JSON.stringify({ ...counts, databaseBytes, sessionId }),
);

function requiredCount(name) {
    const value = Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(name + " must be positive");
    return value;
}

function requiredEvenCount(name) {
    const value = requiredCount(name);
    if (value % 2 !== 0) throw new Error(name + " must be even");
    return value;
}
`;
