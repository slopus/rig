import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { UserMessage } from "../agent/types.js";
import type { PersistedQueuedRun, PersistedSessionState } from "./InMemorySession.js";
import { PersistentSessionStore } from "./PersistentSessionStore.js";

describe("PersistentSessionStore", () => {
    it("restores persisted session state and messages without creating a runtime", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({
                status: "completed",
            });
            const userMessage = textUserMessage("message-1", "persist me");
            store.saveSession(state);
            store.upsertMessage(state.id, {
                isPartial: false,
                message: userMessage,
                position: 0,
                runId: "run-1",
            });
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id);

                expect(restored?.snapshot().status).toBe("completed");
                expect(restored?.snapshot().snapshot.messages).toEqual([userMessage]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("marks running sessions as interrupted after a restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({
                databasePath,
                now: () => 1_700_000_000_000,
            });
            const queuedRun: PersistedQueuedRun = {
                displayText: "queued prompt",
                runId: "run-2",
                text: "queued prompt",
                userMessage: textUserMessage("message-2", "queued prompt"),
            };
            store.saveSession(
                sessionState({
                    activeRunId: "run-1",
                    queuedRuns: [queuedRun],
                    status: "running",
                }),
            );
            store.insertQueuedRun("session-1", queuedRun);
            store.close();

            const restoredStore = new PersistentSessionStore({
                databasePath,
                now: () => 1_700_000_000_100,
            });
            try {
                const restored = restoredStore.get("session-1");
                const events = restored?.events.since(undefined) ?? [];

                expect(restored?.snapshot().status).toBe("error");
                expect(restored?.snapshot().interruption).toMatchObject({
                    reason: "crash",
                    runId: "run-1",
                });
                expect(events.filter((event) => event.type === "run_error")).toHaveLength(2);
                expect(events.map((event) => event.type)).toEqual(["run_error", "run_error"]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("updates partial messages in place while streaming", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const state = sessionState({ status: "running" });
            store.saveSession(state);
            store.upsertMessage(state.id, {
                isPartial: true,
                message: {
                    blocks: [{ text: "hel", type: "text" }],
                    id: "assistant-1",
                    role: "agent",
                },
                position: 0,
                runId: "run-1",
            });
            store.upsertMessage(state.id, {
                isPartial: true,
                message: {
                    blocks: [{ text: "hello", type: "text" }],
                    id: "assistant-1",
                    role: "agent",
                },
                position: 0,
                runId: "run-1",
            });
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get(state.id);

                expect(restored?.state().messages).toEqual([
                    {
                        isPartial: true,
                        message: {
                            blocks: [{ text: "hello", type: "text" }],
                            id: "assistant-1",
                            role: "agent",
                        },
                        position: 0,
                        runId: "run-1",
                    },
                ]);
                expect(restored?.snapshot().snapshot.messages).toEqual([]);
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("emits terminal events for accepted queued runs that are aborted before start", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            const queuedRun: PersistedQueuedRun = {
                displayText: "queued prompt",
                runId: "run-1",
                text: "queued prompt",
                userMessage: textUserMessage("message-1", "queued prompt"),
            };
            store.saveSession(
                sessionState({
                    queuedRuns: [queuedRun],
                    status: "queued",
                }),
            );
            store.insertQueuedRun("session-1", queuedRun);

            const session = store.get("session-1");
            const response = session?.abort();
            const events = session?.events.since(undefined) ?? [];

            expect(response?.aborted).toBe(true);
            expect(events.map((event) => event.type)).toEqual(["abort_requested", "run_error"]);
            expect(events.at(-1)).toMatchObject({
                data: { runId: "run-1" },
                type: "run_error",
            });
            store.close();
        } finally {
            await cleanup();
        }
    });

    it("lists sessions by most recent submitted message", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(
                sessionState({
                    id: "older-session",
                    lastMessageAt: 1_700_000_000_000,
                    title: "Older Work",
                    titleStatus: "ready",
                }),
            );
            store.saveSession(
                sessionState({
                    id: "newer-session",
                    lastMessageAt: 1_700_000_001_000,
                    title: "Newer Work",
                    titleStatus: "ready",
                }),
            );

            const sessions = store.list({ limit: 1 });

            expect(sessions).toEqual([
                expect.objectContaining({
                    id: "newer-session",
                    title: "Newer Work",
                }),
            ]);
            store.close();
        } finally {
            await cleanup();
        }
    });

    it("persists generated session titles", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(
                sessionState({
                    title: "Persisted Title",
                    titleStatus: "ready",
                }),
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const restored = restoredStore.get("session-1");
                const summary = restoredStore.list({ limit: 1 }).at(0);

                expect(restored?.snapshot()).toMatchObject({
                    title: "Persisted Title",
                    titleStatus: "ready",
                });
                expect(summary).toMatchObject({
                    title: "Persisted Title",
                    titleStatus: "ready",
                });
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });

    it("repairs interrupted title generation on restart", async () => {
        const { cleanup, databasePath } = await createDatabasePath();
        try {
            const store = new PersistentSessionStore({ databasePath });
            store.saveSession(
                sessionState({
                    titleStatus: "generating",
                }),
            );
            store.close();

            const restoredStore = new PersistentSessionStore({ databasePath });
            try {
                const summary = restoredStore.list({ limit: 1 }).at(0);

                expect(summary).toMatchObject({
                    titleStatus: "error",
                });
                expect(summary?.titleError).toContain("interrupted");
            } finally {
                restoredStore.close();
            }
        } finally {
            await cleanup();
        }
    });
});

async function createDatabasePath(): Promise<{
    cleanup: () => Promise<void>;
    databasePath: string;
}> {
    const directory = await mkdtemp(join(tmpdir(), "ohmypi-sessions-test-"));
    return {
        cleanup: () => rm(directory, { force: true, recursive: true }),
        databasePath: join(directory, "sessions.sqlite"),
    };
}

function sessionState(overrides: Partial<PersistedSessionState> = {}): PersistedSessionState {
    return {
        agentId: "agent-1",
        cwd: "/tmp/ohmypi-persistent-session-test",
        id: "session-1",
        messages: [],
        modelId: "openai/gpt-5.5",
        models: [],
        providerId: "codex",
        queuedRuns: [],
        status: "idle",
        titleStatus: "idle",
        tools: [],
        ...overrides,
    };
}

function textUserMessage(id: string, text: string): UserMessage {
    return {
        blocks: [{ text, type: "text" }],
        id,
        role: "user",
    };
}
