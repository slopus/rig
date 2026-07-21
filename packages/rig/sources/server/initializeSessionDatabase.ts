import type { DatabaseSync } from "node:sqlite";

const CURRENT_SCHEMA_VERSION = 5;

const sessionColumnMigrations = [
    ["title", "TEXT"],
    ["docker_json", "TEXT"],
    ["secret_ids_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["title_status", "TEXT NOT NULL DEFAULT 'idle'"],
    ["title_error", "TEXT"],
    ["recap", "TEXT"],
    ["metadata_updated_at_ms", "INTEGER"],
    ["metadata_run_id", "TEXT"],
    ["last_message_at_ms", "INTEGER"],
    ["session_kind", "TEXT NOT NULL DEFAULT 'primary'"],
    ["parent_session_id", "TEXT"],
    ["root_session_id", "TEXT"],
    ["depth", "INTEGER NOT NULL DEFAULT 0"],
    ["parent_tool_call_id", "TEXT"],
    ["task_name", "TEXT"],
    ["description", "TEXT"],
    ["active_since_ms", "INTEGER"],
    ["elapsed_ms", "INTEGER NOT NULL DEFAULT 0"],
    ["total_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["context_messages_json", "TEXT"],
    ["service_tier", "TEXT"],
    ["append_system_prompt", "TEXT"],
    ["system_prompt", "TEXT"],
    ["external_tools_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["durable_skills_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["permission_mode", "TEXT NOT NULL DEFAULT 'workspace_write'"],
    ["tasks_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["workflows_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["workflows_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["goal_json", "TEXT"],
    ["next_task_id", "INTEGER NOT NULL DEFAULT 1"],
] as const;

const queuedRunColumnMigrations = [
    ["kind", "TEXT NOT NULL DEFAULT 'user'"],
    ["debug", "INTEGER NOT NULL DEFAULT 0"],
    ["debug_directory", "TEXT"],
    ["integration_config_json", "TEXT"],
] as const;

export function initializeSessionDatabase(database: DatabaseSync): void {
    database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
    `);

    database.exec("BEGIN IMMEDIATE");
    try {
        const versionRow = database.prepare("PRAGMA user_version").get() as
            | { user_version?: bigint | number }
            | undefined;
        const schemaVersion = Number(versionRow?.user_version ?? 0);
        if (schemaVersion > CURRENT_SCHEMA_VERSION) {
            throw new Error(
                `The session database uses schema version ${String(schemaVersion)}, but this Rig version supports up to ${String(CURRENT_SCHEMA_VERSION)}.`,
            );
        }

        database.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                session_kind TEXT NOT NULL DEFAULT 'primary',
                parent_session_id TEXT,
                root_session_id TEXT,
                depth INTEGER NOT NULL DEFAULT 0,
                parent_tool_call_id TEXT,
                task_name TEXT,
                description TEXT,
                cwd TEXT NOT NULL,
                docker_json TEXT,
                secret_ids_json TEXT NOT NULL DEFAULT '[]',
                provider_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                effort TEXT,
                service_tier TEXT,
                instructions TEXT,
                append_system_prompt TEXT,
                system_prompt TEXT,
                external_tools_json TEXT NOT NULL DEFAULT '[]',
                durable_skills_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL,
                active_run_id TEXT,
                active_since_ms INTEGER,
                elapsed_ms INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                last_event_id TEXT,
                permission_mode TEXT NOT NULL DEFAULT 'workspace_write',
                context_messages_json TEXT,
                models_json TEXT NOT NULL,
                tools_json TEXT NOT NULL,
                tasks_json TEXT NOT NULL DEFAULT '[]',
                workflows_json TEXT NOT NULL DEFAULT '[]',
                workflows_enabled INTEGER NOT NULL DEFAULT 1,
                goal_json TEXT,
                next_task_id INTEGER NOT NULL DEFAULT 1,
                title TEXT,
                title_status TEXT NOT NULL DEFAULT 'idle',
                title_error TEXT,
                recap TEXT,
                metadata_updated_at_ms INTEGER,
                metadata_run_id TEXT,
                interrupted INTEGER NOT NULL DEFAULT 0,
                interruption_json TEXT,
                last_message_at_ms INTEGER,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                event_id TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                data_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_messages (
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

            CREATE TABLE IF NOT EXISTS queued_runs (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL,
                debug INTEGER NOT NULL DEFAULT 0,
                debug_directory TEXT,
                display_text TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'user',
                text TEXT NOT NULL,
                user_message_json TEXT NOT NULL,
                integration_config_json TEXT,
                created_at_ms INTEGER NOT NULL,
                PRIMARY KEY (session_id, run_id)
            );

            CREATE TABLE IF NOT EXISTS external_tool_calls (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                run_id TEXT NOT NULL,
                batch_id TEXT NOT NULL,
                tool_call_id TEXT NOT NULL,
                tool_call_index INTEGER NOT NULL,
                definition_json TEXT NOT NULL,
                skill_json TEXT,
                arguments_json TEXT NOT NULL,
                status TEXT NOT NULL,
                resolution_json TEXT,
                consumed INTEGER NOT NULL DEFAULT 0,
                created_at_ms INTEGER NOT NULL,
                resolved_at_ms INTEGER
            );

            CREATE TABLE IF NOT EXISTS durable_user_inputs (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                request_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                batch_id TEXT NOT NULL,
                tool_call_id TEXT NOT NULL,
                tool_call_index INTEGER NOT NULL,
                tool_name TEXT NOT NULL,
                tool_arguments_json TEXT NOT NULL,
                kind TEXT NOT NULL,
                permission_json TEXT,
                request_json TEXT NOT NULL,
                response_json TEXT,
                result_json TEXT,
                status TEXT NOT NULL,
                consumed INTEGER NOT NULL DEFAULT 0,
                created_at_ms INTEGER NOT NULL,
                resolved_at_ms INTEGER,
                PRIMARY KEY (session_id, request_id)
            );

            CREATE TABLE IF NOT EXISTS secret_registrations (
                id TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                environment_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS secret_environment_variables (
                secret_id TEXT NOT NULL REFERENCES secret_registrations(id) ON DELETE CASCADE,
                normalized_name TEXT NOT NULL,
                name TEXT NOT NULL,
                PRIMARY KEY (secret_id, normalized_name)
            );

            CREATE TABLE IF NOT EXISTS project_secret_attachments (
                cwd TEXT NOT NULL,
                secret_id TEXT NOT NULL,
                PRIMARY KEY (cwd, secret_id)
            );

            CREATE TABLE IF NOT EXISTS happy_sessions (
                session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                credential_fingerprint TEXT NOT NULL,
                tag TEXT NOT NULL,
                remote_session_id TEXT,
                encryption_variant TEXT NOT NULL,
                encryption_key_base64 TEXT NOT NULL,
                last_remote_seq INTEGER NOT NULL DEFAULT 0,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS happy_outbox (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                local_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                UNIQUE (session_id, local_id)
            );
        `);

        const sessionColumns = new Set(
            database
                .prepare("PRAGMA table_info(sessions)")
                .all()
                .map((column) => String(column.name)),
        );
        for (const [name, definition] of sessionColumnMigrations) {
            if (sessionColumns.has(name)) continue;
            database.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`);
        }

        const queuedRunColumns = new Set(
            database
                .prepare("PRAGMA table_info(queued_runs)")
                .all()
                .map((column) => String(column.name)),
        );
        for (const [name, definition] of queuedRunColumnMigrations) {
            if (queuedRunColumns.has(name)) continue;
            database.exec(`ALTER TABLE queued_runs ADD COLUMN ${name} ${definition}`);
        }

        const externalToolCallColumns = new Set(
            database
                .prepare("PRAGMA table_info(external_tool_calls)")
                .all()
                .map((column) => String(column.name)),
        );
        if (!externalToolCallColumns.has("skill_json")) {
            database.exec("ALTER TABLE external_tool_calls ADD COLUMN skill_json TEXT");
        }

        database.exec(`
            CREATE INDEX IF NOT EXISTS session_events_session_seq
                ON session_events(session_id, seq);
            CREATE INDEX IF NOT EXISTS session_messages_session_message
                ON session_messages(session_id, message_id);
            CREATE INDEX IF NOT EXISTS sessions_parent_created
                ON sessions(parent_session_id, created_at_ms);
            CREATE INDEX IF NOT EXISTS external_tool_calls_session_created
                ON external_tool_calls(session_id, created_at_ms);
            CREATE INDEX IF NOT EXISTS durable_user_inputs_session_created
                ON durable_user_inputs(session_id, created_at_ms);
            CREATE INDEX IF NOT EXISTS happy_outbox_session_seq
                ON happy_outbox(session_id, seq);
            PRAGMA user_version = ${String(CURRENT_SCHEMA_VERSION)};
            COMMIT;
        `);
    } catch (error) {
        try {
            database.exec("ROLLBACK");
        } catch {
            // Keep the migration failure as the actionable startup error.
        }
        throw error;
    }
}
