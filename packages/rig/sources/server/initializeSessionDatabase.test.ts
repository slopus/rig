import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { initializeSessionDatabase } from "./initializeSessionDatabase.js";

describe("initializeSessionDatabase", () => {
    it("rolls back every schema change when a migration fails", () => {
        const database = new DatabaseSync(":memory:");
        try {
            database.exec(`
                CREATE TABLE sessions (id TEXT PRIMARY KEY);
                CREATE TABLE session_events (seq INTEGER PRIMARY KEY);
                PRAGMA user_version = 0;
            `);

            expect(() => initializeSessionDatabase(database)).toThrow();

            expect(
                database
                    .prepare("PRAGMA table_info(sessions)")
                    .all()
                    .map((column) => column.name),
            ).toEqual(["id"]);
            expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
            expect(
                database
                    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                    .all()
                    .map((row) => row.name),
            ).toEqual(["session_events", "sessions"]);
        } finally {
            database.close();
        }
    });

    it("refuses to open a database from a newer Rig schema", () => {
        const database = new DatabaseSync(":memory:");
        try {
            database.exec("PRAGMA user_version = 6");

            expect(() => initializeSessionDatabase(database)).toThrow(
                "The session database uses schema version 6, but this Rig version supports up to 5.",
            );
            expect(
                database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
            ).toEqual([]);
        } finally {
            database.close();
        }
    });
});
