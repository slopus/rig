import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { ProtocolHttpClient } from "../client/ProtocolHttpClient.js";
import { createEventIdFactory, type SessionEvent } from "../protocol/index.js";
import { modelOpenaiGpt55 } from "../providers/models.js";
import { InMemorySessionStore } from "./InMemorySessionStore.js";
import { createProtocolHttpServer } from "./createProtocolHttpServer.js";

describe("createProtocolHttpServer", () => {
    it("requires bearer auth", async () => {
        const { close, socketPath } = await startServer();
        try {
            const client = new ProtocolHttpClient({ socketPath, token: "wrong" });
            await expect(client.health()).rejects.toThrow("Unauthorized");
        } finally {
            await close();
        }
    });

    it("serves daemon readiness and model catalog", async () => {
        const { client, close } = await startServer();
        try {
            const health = await client.health();
            const models = await client.models();

            expect(health).toMatchObject({
                healthy: true,
                ready: true,
                status: "ready",
            });
            expect(health.catalog?.models.map((model) => model.id)).toContain(modelOpenaiGpt55.id);
            expect(models.catalog.models.map((model) => model.id)).toContain(modelOpenaiGpt55.id);
        } finally {
            await close();
        }
    });

    it("changes session effort through a dedicated endpoint", async () => {
        const { client, close } = await startServer();
        try {
            const created = await client.createSession({
                cwd: "/tmp/ohmypi-protocol-test",
                modelId: modelOpenaiGpt55.id,
            });

            const changed = await client.changeEffort(created.session.id, { effort: "high" });
            const events = await client.getEvents(created.session.id, created.session.lastEventId);

            expect(changed.session.effort).toBe("high");
            expect(events.events.at(-1)).toMatchObject({
                data: {
                    effort: "high",
                    modelId: modelOpenaiGpt55.id,
                },
                type: "effort_changed",
            });
        } finally {
            await close();
        }
    });

    it("serves catch-up events since a cursor", async () => {
        const { client, close, store } = await startServer();
        try {
            const created = await client.createSession({ cwd: "/tmp/ohmypi-protocol-test" });
            const session = store.get(created.session.id);
            expect(session).toBeDefined();
            const createEventId = createEventIdFactory({ now: () => 1_700_000_000_000 });
            const first = sessionResetEvent(created.session.id, createEventId());
            const second = sessionResetEvent(created.session.id, createEventId());
            session?.events.append(first);
            session?.events.append(second);

            const received = await client.getEvents(created.session.id, first.id);

            expect(received.events.map((event) => event.id)).toEqual([second.id]);
        } finally {
            await close();
        }
    });

    it("serves session summaries", async () => {
        const { client, close } = await startServer();
        try {
            await client.createSession({ cwd: "/tmp/ohmypi-protocol-test-a" });
            await client.createSession({ cwd: "/tmp/ohmypi-protocol-test-b" });

            const response = await client.listSessions(1);

            expect(response.sessions).toHaveLength(1);
            expect(response.sessions[0]).toMatchObject({
                status: "idle",
                titleStatus: "idle",
            });
        } finally {
            await close();
        }
    });

    it("accepts shutdown requests", async () => {
        let shutdownRequested = false;
        const { client, close } = await startServer({
            onShutdown: () => {
                shutdownRequested = true;
            },
        });
        try {
            await expect(client.shutdown()).resolves.toEqual({ shuttingDown: true });
            await new Promise((resolve) => setImmediate(resolve));

            expect(shutdownRequested).toBe(true);
        } finally {
            await close();
        }
    });
});

async function startServer(options: { onShutdown?: () => void } = {}): Promise<{
    client: ProtocolHttpClient;
    close: () => Promise<void>;
    socketPath: string;
    store: InMemorySessionStore;
}> {
    const directory = await mkdtemp(join(tmpdir(), "ohmypi-server-test-"));
    const socketPath = join(directory, "server.sock");
    const store = new InMemorySessionStore();
    const server = createProtocolHttpServer({
        ...(options.onShutdown !== undefined ? { onShutdown: options.onShutdown } : {}),
        store,
        token: "secret",
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => {
            server.off("error", reject);
            resolve();
        });
    });

    return {
        client: new ProtocolHttpClient({ socketPath, token: "secret" }),
        socketPath,
        store,
        async close() {
            await new Promise<void>((resolve) => server.close(() => resolve()));
            await rm(directory, { recursive: true, force: true });
        },
    };
}

function sessionResetEvent(sessionId: string, id: string): SessionEvent {
    return {
        createdAt: 1_700_000_000_000,
        data: {
            snapshot: {
                id: "agent-1",
                messages: [],
                modelId: "openai/gpt-5.5",
                providerId: "codex",
                queue: [],
                status: "idle",
                tools: [],
            },
        },
        id,
        sessionId,
        type: "session_reset",
    };
}
