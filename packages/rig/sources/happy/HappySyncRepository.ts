import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { HappyEncryptionVariant, HappySessionProtocolMessage } from "./types.js";

const MAX_PENDING_MESSAGES_PER_SESSION = 10_000;

export class HappySyncOutboxFullError extends Error {}

export interface HappySessionState {
    credentialFingerprint: string;
    encryptionKey: Uint8Array;
    encryptionVariant: HappyEncryptionVariant;
    lastRemoteSeq: number;
    remoteSessionId?: string;
    sessionId: string;
    tag: string;
}

export class HappySyncRepository {
    readonly #database: DatabaseSync;
    readonly #maxPendingMessagesPerSession: number;
    readonly #now: () => number;

    constructor(
        databasePath: string,
        now: () => number = Date.now,
        maxPendingMessagesPerSession = MAX_PENDING_MESSAGES_PER_SESSION,
    ) {
        this.#database = new DatabaseSync(databasePath, {
            enableForeignKeyConstraints: true,
            timeout: 5_000,
        });
        this.#database.exec(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;",
        );
        this.#maxPendingMessagesPerSession = maxPendingMessagesPerSession;
        this.#now = now;
    }

    acknowledge(sessionId: string, localIds: readonly string[]): void {
        if (localIds.length === 0) return;
        const remove = this.#database.prepare(
            "DELETE FROM happy_outbox WHERE session_id = ? AND local_id = ?",
        );
        this.#transaction(() => {
            for (const localId of localIds) remove.run(sessionId, localId);
        });
    }

    close(): void {
        this.#database.close();
    }

    enqueue(sessionId: string, messages: readonly HappySessionProtocolMessage[]): void {
        if (messages.length === 0) return;
        const insert = this.#database.prepare(
            `
            INSERT OR IGNORE INTO happy_outbox (session_id, local_id, payload_json, created_at_ms)
            VALUES (?, ?, ?, ?)
            `,
        );
        this.#transaction(() => {
            for (const message of messages) {
                insert.run(sessionId, message.localId, JSON.stringify(message), this.#now());
            }
            const row = this.#database
                .prepare(
                    `
                    SELECT COUNT(*) AS pending_count
                    FROM happy_outbox
                    WHERE session_id = ?
                    `,
                )
                .get(sessionId) as Record<string, unknown>;
            if (Number(row.pending_count) > this.#maxPendingMessagesPerSession) {
                throw new HappySyncOutboxFullError(
                    `Happy sync outbox is full for session ${sessionId}; reconnect before sending more messages.`,
                );
            }
        });
    }

    ensureSession(options: {
        credentialFingerprint: string;
        encryptionKey?: Uint8Array;
        encryptionVariant: HappyEncryptionVariant;
        sessionId: string;
    }): HappySessionState {
        const current = this.getSession(options.sessionId);
        if (
            current?.credentialFingerprint === options.credentialFingerprint &&
            current.encryptionVariant === options.encryptionVariant
        ) {
            return current;
        }
        const now = this.#now();
        const encryptionKey =
            options.encryptionKey === undefined
                ? new Uint8Array(randomBytes(32))
                : new Uint8Array(options.encryptionKey);
        if (encryptionKey.length !== 32) {
            throw new Error("Happy session encryption keys must contain 32 bytes.");
        }
        const tag = `rig:${options.sessionId}`;
        this.#transaction(() => {
            this.#database
                .prepare(
                    `
                    INSERT INTO happy_sessions (
                        session_id, credential_fingerprint, tag, remote_session_id,
                        encryption_variant, encryption_key_base64, last_remote_seq,
                        created_at_ms, updated_at_ms
                    ) VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                        credential_fingerprint = excluded.credential_fingerprint,
                        tag = excluded.tag,
                        remote_session_id = NULL,
                        encryption_variant = excluded.encryption_variant,
                        encryption_key_base64 = excluded.encryption_key_base64,
                        last_remote_seq = 0,
                        updated_at_ms = excluded.updated_at_ms
                    `,
                )
                .run(
                    options.sessionId,
                    options.credentialFingerprint,
                    tag,
                    options.encryptionVariant,
                    Buffer.from(encryptionKey).toString("base64"),
                    now,
                    now,
                );
            if (current !== undefined) {
                this.#database
                    .prepare("DELETE FROM happy_outbox WHERE session_id = ?")
                    .run(options.sessionId);
            }
        });
        return {
            credentialFingerprint: options.credentialFingerprint,
            encryptionKey,
            encryptionVariant: options.encryptionVariant,
            lastRemoteSeq: 0,
            sessionId: options.sessionId,
            tag,
        };
    }

    getSession(sessionId: string): HappySessionState | undefined {
        const row = this.#database
            .prepare(
                `
                SELECT credential_fingerprint, tag, remote_session_id, encryption_variant,
                       encryption_key_base64, last_remote_seq
                FROM happy_sessions
                WHERE session_id = ?
                `,
            )
            .get(sessionId) as Record<string, unknown> | undefined;
        if (row === undefined) return undefined;
        const remoteSessionId = optionalString(row.remote_session_id);
        return {
            credentialFingerprint: requiredString(row.credential_fingerprint),
            encryptionKey: new Uint8Array(
                Buffer.from(requiredString(row.encryption_key_base64), "base64"),
            ),
            encryptionVariant: requiredString(row.encryption_variant) as HappyEncryptionVariant,
            lastRemoteSeq: Number(row.last_remote_seq),
            ...(remoteSessionId === undefined ? {} : { remoteSessionId }),
            sessionId,
            tag: requiredString(row.tag),
        };
    }

    pending(sessionId: string, limit = 50): readonly HappySessionProtocolMessage[] {
        return this.#database
            .prepare(
                `
                SELECT payload_json FROM happy_outbox
                WHERE session_id = ?
                ORDER BY seq ASC
                LIMIT ?
                `,
            )
            .all(sessionId, limit)
            .map((row) =>
                JSON.parse(requiredString((row as Record<string, unknown>).payload_json)),
            ) as HappySessionProtocolMessage[];
    }

    setRemoteSession(sessionId: string, remoteSessionId: string): void {
        this.#database
            .prepare(
                "UPDATE happy_sessions SET remote_session_id = ?, updated_at_ms = ? WHERE session_id = ?",
            )
            .run(remoteSessionId, this.#now(), sessionId);
    }

    updateLastRemoteSeq(sessionId: string, sequence: number): void {
        this.#database
            .prepare(
                `
                UPDATE happy_sessions
                SET last_remote_seq = MAX(last_remote_seq, ?), updated_at_ms = ?
                WHERE session_id = ?
                `,
            )
            .run(sequence, this.#now(), sessionId);
    }

    #transaction<T>(operation: () => T): T {
        this.#database.exec("BEGIN IMMEDIATE");
        try {
            const result = operation();
            this.#database.exec("COMMIT");
            return result;
        } catch (error) {
            try {
                this.#database.exec("ROLLBACK");
            } catch {
                // Preserve the original storage error.
            }
            throw error;
        }
    }
}

function requiredString(value: unknown): string {
    if (typeof value !== "string") throw new Error("Happy sync storage is invalid.");
    return value;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}
