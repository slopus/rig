import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const MIGRATED_MARKER = "DAEMON_MIGRATED_EXISTING_SQLITE_SCHEMA";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("daemon startup with an existing SQLite database", () => {
    it("atomically applies every schema migration before becoming ready", async () => {
        const gym = await createGym({
            mode: "docker",
            entrypoint: ["bash", "/workspace/start-with-legacy-database.sh"],
            files: {
                "create-legacy-database.mjs": createLegacyDatabaseScript,
                "start-with-legacy-database.sh": startWithLegacyDatabaseScript,
                "verify-migrated-database.mjs": verifyMigratedDatabaseScript,
            },
            inference: [],
            startupText: MIGRATED_MARKER,
            timeoutMs: 30_000,
        });
        running.add(gym);

        const started = await gym.terminal.snapshot();
        expect(started.text).toContain("Daemon is running");
        expect(started.text).toContain(MIGRATED_MARKER);
    }, 120_000);
});

const createLegacyDatabaseScript = `
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const databasePath = "/home/rig/.rig/sessions.sqlite";
mkdirSync("/home/rig/.rig", { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(\`
    CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_kind TEXT NOT NULL DEFAULT 'primary',
        parent_session_id TEXT,
        root_session_id TEXT,
        depth INTEGER NOT NULL DEFAULT 0,
        parent_tool_call_id TEXT,
        description TEXT,
        cwd TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        effort TEXT,
        instructions TEXT,
        status TEXT NOT NULL,
        active_run_id TEXT,
        last_event_id TEXT,
        models_json TEXT NOT NULL,
        tools_json TEXT NOT NULL,
        title TEXT,
        title_status TEXT NOT NULL DEFAULT 'idle',
        title_error TEXT,
        interrupted INTEGER NOT NULL DEFAULT 0,
        interruption_json TEXT,
        last_message_at_ms INTEGER,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE session_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        data_json TEXT NOT NULL
    );

    CREATE TABLE session_messages (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL,
        is_partial INTEGER NOT NULL DEFAULT 0,
        run_id TEXT,
        message_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (session_id, position)
    );

    CREATE TABLE queued_runs (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        display_text TEXT NOT NULL,
        text TEXT NOT NULL,
        user_message_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (session_id, run_id)
    );

    CREATE TABLE external_tool_calls (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool_call_index INTEGER NOT NULL,
        definition_json TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        status TEXT NOT NULL,
        resolution_json TEXT,
        consumed INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        resolved_at_ms INTEGER
    );

    INSERT INTO sessions (
        id,
        agent_id,
        root_session_id,
        cwd,
        provider_id,
        model_id,
        status,
        models_json,
        tools_json,
        created_at_ms,
        updated_at_ms
    ) VALUES (
        'legacy-session',
        'legacy-agent',
        'legacy-session',
        '/workspace',
        'codex',
        'openai/gpt-5.5',
        'idle',
        '[]',
        '[]',
        1,
        1
    );

    PRAGMA user_version = 0;
\`);
database.close();
`;

const verifyMigratedDatabaseScript = String.raw`
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/home/rig/.rig/sessions.sqlite", { readOnly: true });
const sessionColumns = new Set(
    database.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name),
);
const queuedRunColumns = new Set(
    database.prepare("PRAGMA table_info(queued_runs)").all().map((column) => column.name),
);
const expectedSessionColumns = [
    "active_since_ms",
    "append_system_prompt",
    "context_messages_json",
    "docker_json",
    "durable_skills_json",
    "elapsed_ms",
    "external_tools_json",
    "goal_json",
    "metadata_run_id",
    "metadata_updated_at_ms",
    "next_task_id",
    "permission_mode",
    "recap",
    "secret_ids_json",
    "service_tier",
    "system_prompt",
    "task_name",
    "tasks_json",
    "total_tokens",
    "workflows_enabled",
    "workflows_json",
];
const expectedQueuedRunColumns = ["debug", "debug_directory", "integration_config_json", "kind"];

for (const column of expectedSessionColumns) {
    if (!sessionColumns.has(column)) throw new Error("Missing migrated sessions column: " + column);
}
for (const column of expectedQueuedRunColumns) {
    if (!queuedRunColumns.has(column)) throw new Error("Missing migrated queued_runs column: " + column);
}
const externalCallsTable = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'external_tool_calls'")
    .get();
if (externalCallsTable?.name !== "external_tool_calls") {
    throw new Error("Missing migrated external_tool_calls table.");
}
const externalCallColumns = new Set(
    database.prepare("PRAGMA table_info(external_tool_calls)").all().map((column) => column.name),
);
if (!externalCallColumns.has("skill_json")) {
    throw new Error("Missing migrated external_tool_calls skill column.");
}

const version = database.prepare("PRAGMA user_version").get().user_version;
if (version !== 3) throw new Error("Expected schema version 3, received " + String(version));

const session = database
    .prepare("SELECT id, permission_mode, tasks_json, workflows_json FROM sessions WHERE id = ?")
    .get("legacy-session");
if (session?.id !== "legacy-session") throw new Error("The legacy session was not preserved.");
if (session.permission_mode !== "workspace_write") throw new Error("Missing permission default.");
if (session.tasks_json !== "[]") throw new Error("Missing tasks default.");
if (session.workflows_json !== "[]") throw new Error("Missing workflows default.");
database.close();
`;

const startWithLegacyDatabaseScript = String.raw`#!/usr/bin/env bash
set -euo pipefail

node /workspace/create-legacy-database.mjs
node /app/packages/rig/dist/main.js daemon start
node /app/packages/rig/dist/main.js daemon status
node /workspace/verify-migrated-database.mjs
echo ${MIGRATED_MARKER}
sleep 60
`;
