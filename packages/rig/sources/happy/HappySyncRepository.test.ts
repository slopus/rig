import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { initializeSessionDatabase } from "../server/initializeSessionDatabase.js";
import { HappySyncRepository } from "./HappySyncRepository.js";

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
});

describe("HappySyncRepository", () => {
    it("rejects new messages without deleting pending delivery work when the outbox is full", async () => {
        const { databasePath, repository } = await createRepository();
        repository.close();
        const bounded = new HappySyncRepository(databasePath, Date.now, 2);
        const first = createMessage("message-1");
        const second = createMessage("message-2");
        bounded.enqueue("session-1", [first, second]);

        expect(() => bounded.enqueue("session-1", [createMessage("message-3")])).toThrow(
            "Happy sync outbox is full",
        );
        expect(bounded.pending("session-1")).toEqual([first, second]);
        bounded.close();
    });

    it("keeps a random session key and remote cursor across daemon restarts", async () => {
        const { databasePath, repository } = await createRepository();
        const first = repository.ensureSession({
            credentialFingerprint: "account-1",
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });
        repository.setRemoteSession("session-1", "remote-1");
        repository.updateLastRemoteSeq("session-1", 12);
        repository.close();

        const reopened = new HappySyncRepository(databasePath);
        const second = reopened.ensureSession({
            credentialFingerprint: "account-1",
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });

        expect(second.encryptionKey).toEqual(first.encryptionKey);
        expect(second).toMatchObject({ lastRemoteSeq: 12, remoteSessionId: "remote-1" });
        reopened.close();
    });

    it("rotates remote state when the authenticated Happy account changes", async () => {
        const { repository } = await createRepository();
        const first = repository.ensureSession({
            credentialFingerprint: "account-1",
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });
        repository.setRemoteSession("session-1", "remote-1");
        repository.enqueue("session-1", [createMessage("encrypted-for-account-1")]);

        const rotated = repository.ensureSession({
            credentialFingerprint: "account-2",
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });

        expect(rotated.remoteSessionId).toBeUndefined();
        expect(rotated.encryptionKey).not.toEqual(first.encryptionKey);
        expect(repository.pending("session-1")).toEqual([]);
        repository.close();
    });
});

function createMessage(localId: string) {
    return {
        content: {
            ev: { t: "service" as const, text: localId },
            id: localId,
            role: "agent" as const,
            time: 1,
        },
        localId,
        meta: { sentFrom: "rig" as const },
        role: "session" as const,
    };
}

async function createRepository() {
    const directory = await mkdtemp(join(tmpdir(), "rig-happy-repository-"));
    directories.push(directory);
    const databasePath = join(directory, "sessions.sqlite");
    const database = new DatabaseSync(databasePath);
    initializeSessionDatabase(database);
    database
        .prepare(
            `
            INSERT INTO sessions (
                id, agent_id, cwd, provider_id, model_id, status, models_json, tools_json,
                created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
        )
        .run("session-1", "agent-1", "/workspace", "codex", "model", "idle", "[]", "[]", 1, 1);
    database.close();
    return { databasePath, repository: new HappySyncRepository(databasePath) };
}
