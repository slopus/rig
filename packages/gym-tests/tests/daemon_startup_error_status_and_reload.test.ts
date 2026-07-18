import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const COMPLETED_MARKER = "DAEMON_STARTUP_ERROR_STATUS_AND_RELOAD_COMPLETE";
const STARTUP_ERROR =
    "The session database uses schema version 4, but this Rig version supports up to 3.";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("daemon startup failure handling", () => {
    it("keeps reporting the startup error and supports stop and reload", async () => {
        const gym = await createGym({
            entrypoint: ["bash", "/workspace/exercise-daemon-startup-error.sh"],
            files: {
                "create-newer-database.mjs": createNewerDatabaseScript,
                "exercise-daemon-startup-error.sh": exerciseDaemonStartupErrorScript,
                "make-database-compatible.mjs": makeDatabaseCompatibleScript,
            },
            inference: [],
            startupText: COMPLETED_MARKER,
            timeoutMs: 30_000,
        });
        running.add(gym);

        const started = await gym.terminal.snapshot();
        expect(started.text.replaceAll(/\s/g, "")).toContain(STARTUP_ERROR.replaceAll(/\s/g, ""));
        expect(started.text).toContain("Daemon could not start");
        expect(started.text).toContain("Daemon is stopping");
        expect(started.text).toContain("Daemon is running");
        expect(started.text).toContain("Daemon is not running");
        expect(started.text).not.toContain("Timed out while waiting for the local Rig server");
        expect(started.text).toContain(COMPLETED_MARKER);
    }, 120_000);
});

const createNewerDatabaseScript = String.raw`
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const databasePath = "/home/rig/.rig/sessions.sqlite";
mkdirSync("/home/rig/.rig", { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA user_version = 4");
database.close();
`;

const makeDatabaseCompatibleScript = String.raw`
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/home/rig/.rig/sessions.sqlite");
database.exec("PRAGMA user_version = 0");
database.close();
`;

const exerciseDaemonStartupErrorScript = String.raw`#!/usr/bin/env bash
set -euo pipefail

rig() {
    node /app/packages/rig/dist/main.js "$@"
}

registry_path="/tmp/rig-$(id -u)/server.json"

wait_for_exit() {
    local daemon_pid="$1"
    for _ in $(seq 1 200); do
        if ! kill -0 "$daemon_pid" 2>/dev/null; then
            return 0
        fi
        sleep 0.05
    done
    echo "Daemon process $daemon_pid did not exit." >&2
    return 1
}

expect_startup_error() {
    local output
    local exit_code
    set +e
    output=$(rig daemon start 2>&1)
    exit_code=$?
    set -e
    printf '%s\n' "$output"
    if [[ $exit_code -eq 0 ]]; then
        echo "Expected daemon start to fail." >&2
        return 1
    fi
    if [[ "$output" != *"${STARTUP_ERROR}"* ]]; then
        echo "Daemon start did not report the startup error." >&2
        return 1
    fi
}

expect_error_status() {
    local output
    output=$(rig daemon status)
    printf '%s\n' "$output"
    if [[ "$output" != "Daemon could not start: ${STARTUP_ERROR}" ]]; then
        echo "Daemon status did not preserve the startup error." >&2
        return 1
    fi
}

node /workspace/create-newer-database.mjs

expect_startup_error
expect_error_status
first_pid=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pid))' "$registry_path")
expect_error_status
second_pid=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pid))' "$registry_path")
test "$first_pid" = "$second_pid"

rig daemon stop
wait_for_exit "$first_pid"
rig daemon status

expect_startup_error
error_pid=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pid))' "$registry_path")
node /workspace/make-database-compatible.mjs
rig daemon reload
ready_pid=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pid))' "$registry_path")
test "$error_pid" != "$ready_pid"
rig daemon status

rig daemon stop
wait_for_exit "$ready_pid"
rig daemon status

echo ${COMPLETED_MARKER}
sleep 60
`;
