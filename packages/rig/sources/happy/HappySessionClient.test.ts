import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";
import tweetnacl from "tweetnacl";

import type { InMemorySession } from "../server/InMemorySession.js";
import { initializeSessionDatabase } from "../server/initializeSessionDatabase.js";
import { decryptHappyPayload, encryptHappyPayload } from "./happyEncryption.js";
import { HappySessionClient } from "./HappySessionClient.js";
import { HappySyncRepository } from "./HappySyncRepository.js";
import type { HappyConnectionConfiguration, HappyRemoteMessage } from "./types.js";

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
});

describe("HappySessionClient", () => {
    it("creates a v3 session, flushes encrypted messages, and delivers mobile input once", async () => {
        const { databasePath, repository } = await createRepository();
        const sessionKey = new Uint8Array(32).fill(7);
        const account = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(9));
        repository.ensureSession({
            credentialFingerprint: "account",
            encryptionKey: sessionKey,
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });
        const submitted: unknown[] = [];
        const { session } = fakeSession(submitted);
        const outbound: Array<{ content: string; localId: string }> = [];
        let servedMobileMessage = false;
        const mobilePayload = Buffer.from(
            encryptHappyPayload(sessionKey, "dataKey", {
                content: { text: "Continue from my phone.", type: "text" },
                role: "user",
            }),
        ).toString("base64");
        const socket = new FakeSocket();
        const request = vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/v1/sessions")) {
                const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
                expect(body).toMatchObject({ agentState: null, tag: "rig:session-1" });
                expect(unwrapDataKey(String(body.dataEncryptionKey), account.secretKey)).toEqual(
                    sessionKey,
                );
                return Response.json({
                    session: {
                        id: "remote-1",
                        metadata: body.metadata,
                        metadataVersion: 0,
                        seq: 0,
                    },
                });
            }
            if (init?.method === "POST") {
                const body = JSON.parse(String(init.body)) as {
                    messages: Array<{ content: string; localId: string }>;
                };
                outbound.push(...body.messages);
                return Response.json({ messages: [] });
            }
            const messages: HappyRemoteMessage[] = servedMobileMessage
                ? []
                : [
                      {
                          content: { c: mobilePayload, t: "encrypted" },
                          createdAt: 1,
                          id: "mobile-1",
                          localId: "mobile-local-1",
                          seq: 1,
                          updatedAt: 1,
                      },
                  ];
            servedMobileMessage = true;
            return Response.json({ hasMore: false, messages });
        });
        const client = new HappySessionClient({
            configuration: configuration(account.publicKey),
            fetch: request,
            repository,
            session,
            socketFactory: () => socket,
        });
        client.enqueue([
            {
                content: {
                    ev: { t: "text", text: "Hello" },
                    id: "local-1",
                    role: "user",
                    time: 1,
                },
                localId: "rig:local-1",
                meta: { sentFrom: "rig" },
                role: "session",
            },
        ]);
        client.start();

        await waitFor(() => submitted.length === 1 && outbound.length === 1);

        expect(
            decryptHappyPayload(sessionKey, "dataKey", Buffer.from(outbound[0]!.content, "base64")),
        ).toMatchObject({ content: { id: "local-1" }, role: "session" });
        expect(submitted).toEqual([
            {
                clientSubmissionId: "happy:mobile-1",
                displayText: "Continue from my phone.",
                text: "Continue from my phone.",
            },
        ]);
        expect(repository.getSession("session-1")?.lastRemoteSeq).toBe(1);
        expect(socket.emitted.find(([event]) => event === "session-alive")?.[1]).not.toHaveProperty(
            "mode",
        );
        await client.close();
        repository.close();
        expect(databasePath).toBeTruthy();
    });

    it("publishes Rig identity, provider-qualified models, reasoning, and live activity", async () => {
        const { repository } = await createRepository();
        const sessionKey = new Uint8Array(32).fill(7);
        const account = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(9));
        repository.ensureSession({
            credentialFingerprint: "account",
            encryptionKey: sessionKey,
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });
        const harness = fakeSession([]);
        const socket = new FakeSocket();
        const request = vi.fn<typeof fetch>(async (input, init) => {
            if (String(input).endsWith("/v1/sessions")) {
                const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
                const initial = decryptHappyPayload(
                    sessionKey,
                    "dataKey",
                    Buffer.from(String(body.metadata), "base64"),
                ) as any;
                expect(initial).toMatchObject({
                    capabilities: {
                        abort: true,
                        attachments: { enabled: true },
                        modelSelection: true,
                        permissionModeSelection: true,
                        reasoningSelection: true,
                        resume: false,
                    },
                    client: { id: "rig", name: "Rig" },
                    currentModelCode: "gpt-test",
                    currentModelProviderId: "codex",
                    currentOperatingModeCode: "auto",
                    models: [
                        {
                            code: "gpt-test",
                            id: "gpt-test",
                            name: "GPT Test",
                            providerId: "codex",
                            providerKind: "codex",
                            providerName: "OpenAI Codex",
                            thinkingLevels: ["low", "high"],
                        },
                        {
                            code: "claude-test",
                            id: "claude-test",
                            name: "Claude Test",
                            providerId: "claude",
                            providerKind: "claude",
                            providerName: "Anthropic Claude",
                            thinkingLevels: ["high"],
                        },
                    ],
                    provider: { id: "codex", kind: "codex", name: "OpenAI Codex" },
                    providers: [
                        { id: "codex", kind: "codex", name: "OpenAI Codex" },
                        { id: "claude", kind: "claude", name: "Anthropic Claude" },
                    ],
                    operatingModes: [
                        { code: "auto", kind: "safe-yolo", value: "Auto" },
                        {
                            code: "workspace_write",
                            kind: "default",
                            value: "Workspace write",
                        },
                        { code: "read_only", kind: "read-only", value: "Read only" },
                        { code: "full_access", kind: "yolo", value: "Full access" },
                    ],
                    permissionMode: "auto",
                });
                return Response.json({
                    session: {
                        id: "remote-1",
                        metadata: body.metadata,
                        metadataVersion: 0,
                    },
                });
            }
            return Response.json({ hasMore: false, messages: [] });
        });
        const client = new HappySessionClient({
            configuration: configuration(account.publicKey),
            fetch: request,
            getSubagents: () => [
                {
                    agentId: "agent-2",
                    createdAt: 1,
                    depth: 1,
                    description: "Working",
                    id: "subagent-1",
                    modelId: "gpt-test",
                    parentSessionId: "session-1",
                    status: "running",
                    updatedAt: 1,
                },
            ],
            modelCatalog: {
                defaultModelId: "gpt-test",
                defaultProviderId: "codex",
                models: [],
                providers: [
                    { models: harness.snapshot.models, providerId: "codex" },
                    {
                        models: [
                            {
                                defaultThinkingLevel: "high",
                                id: "claude-test",
                                name: "Claude Test",
                                thinkingLevels: ["high"],
                            },
                        ],
                        providerId: "claude",
                    },
                ],
            },
            repository,
            session: harness.session,
            socketFactory: () => socket,
        });
        client.start();
        await waitFor(() => socket.emitted.some(([event]) => event === "session-alive"));

        harness.snapshot.title = "Updated from Rig";
        harness.snapshot.backgroundProcesses = [
            { command: "pnpm test", cwd: "/workspace", sessionId: 4, status: "running" },
        ];
        harness.snapshot.workflows = [
            {
                agentCount: 1,
                code: "test",
                description: "Test",
                logs: [],
                name: "Tests",
                runId: "workflow-1",
                startedAt: 1,
                status: "running",
                taskId: "task-1",
            },
        ];
        client.kick();

        await waitFor(() => socket.emitted.some(([event]) => event === "update-metadata"));
        const update = socket.emitted.find(([event]) => event === "update-metadata")?.[1] as any;
        const metadata = decryptHappyPayload(
            sessionKey,
            "dataKey",
            Buffer.from(update.metadata, "base64"),
        );
        expect(metadata).toMatchObject({
            activity: {
                processes: { running: 1 },
                subagents: { running: 1, total: 1 },
                workflows: { running: 1, total: 1 },
            },
            name: "Updated from Rig",
            summary: { text: "Updated from Rig" },
        });

        await client.close();
        repository.close();
    });

    it("applies provider-qualified model and reasoning, decrypts attachments, and handles abort RPC", async () => {
        const { repository } = await createRepository();
        const sessionKey = new Uint8Array(32).fill(7);
        const account = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(9));
        repository.ensureSession({
            credentialFingerprint: "account",
            encryptionKey: sessionKey,
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });
        const submitted: unknown[] = [];
        const harness = fakeSession(submitted);
        const image = new Uint8Array([1, 2, 3, 4]);
        const encryptedImage = encryptBlob(image, deriveBlobKey(sessionKey, "dataKey"));
        const filePayload = encodeRemote(sessionKey, {
            content: {
                data: {
                    ev: {
                        mimeType: "image/png",
                        name: "photo.png",
                        ref: "sessions/remote-1/attachments/photo.enc",
                        size: image.length,
                        t: "file",
                    },
                    id: "file-1",
                    role: "user",
                    time: 1,
                },
                type: "session",
            },
            role: "session",
        });
        const textPayload = encodeRemote(sessionKey, {
            content: { text: "Inspect this.", type: "text" },
            meta: {
                effort: "low",
                model: "gpt-test",
                modelProviderId: "codex",
                permissionMode: "read_only",
                sentFrom: "ios",
            },
            role: "user",
        });
        let allowText = false;
        const socket = new FakeSocket();
        const request = vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url.endsWith("/v1/sessions")) {
                const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
                return Response.json({
                    session: {
                        id: "remote-1",
                        metadata: body.metadata,
                        metadataVersion: 0,
                    },
                });
            }
            if (url.endsWith("/attachments/request-download")) {
                return Response.json({ downloadUrl: "https://happy.test/blob/photo.enc" });
            }
            if (url.endsWith("/blob/photo.enc")) return new Response(encryptedImage);
            if (!allowText) {
                return Response.json({
                    hasMore: false,
                    messages: [remoteMessage("mobile-file", 1, filePayload)],
                });
            }
            return Response.json({
                hasMore: false,
                messages: [
                    remoteMessage("mobile-file", 1, filePayload),
                    remoteMessage("mobile-text", 2, textPayload),
                ],
            });
        });
        const client = new HappySessionClient({
            configuration: configuration(account.publicKey),
            fetch: request,
            repository,
            session: harness.session,
            socketFactory: () => socket,
        });
        client.start();

        await waitFor(() =>
            request.mock.calls.some(([input]) =>
                String(input).endsWith("/attachments/request-download"),
            ),
        );
        expect(repository.getSession("session-1")?.lastRemoteSeq).toBe(0);
        allowText = true;
        client.kick();
        await waitFor(() => submitted.length === 1);
        expect(harness.changedModels).toEqual([
            { effort: "low", modelId: "gpt-test", providerId: "codex" },
        ]);
        expect(harness.changedPermissionModes).toEqual(["read_only"]);
        expect(submitted).toEqual([
            expect.objectContaining({
                clientSubmissionId: "happy:mobile-text",
                content: [
                    { text: "Inspect this.", type: "text" },
                    { data: "AQIDBA==", mediaType: "image/png", type: "image" },
                ],
            }),
        ]);
        expect(repository.getSession("session-1")?.lastRemoteSeq).toBe(2);

        const rpcResponse = await socket.requestRpc({
            method: "remote-1:abort",
            params: encodeRemote(sessionKey, { reason: "Stop" }),
        });
        expect(
            decryptHappyPayload(sessionKey, "dataKey", Buffer.from(rpcResponse, "base64")),
        ).toEqual({ aborted: true });
        expect(harness.abortCalls).toBe(1);

        await client.close();
        repository.close();
    });

    it("retries a versioned metadata update after a concurrent Happy update", async () => {
        const { repository } = await createRepository();
        const sessionKey = new Uint8Array(32).fill(7);
        const account = tweetnacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(9));
        repository.ensureSession({
            credentialFingerprint: "account",
            encryptionKey: sessionKey,
            encryptionVariant: "dataKey",
            sessionId: "session-1",
        });
        let acknowledgement = 0;
        const socket = new FakeSocket((value) => {
            acknowledgement += 1;
            return acknowledgement === 1
                ? {
                      metadata: encodeRemote(sessionKey, {
                          archivedBy: "user",
                          lifecycleState: "archiveRequested",
                      }),
                      result: "version-mismatch",
                      version: 4,
                  }
                : { result: "success", version: Number(value.expectedVersion) + 1 };
        });
        const request = vi.fn<typeof fetch>(async (input) => {
            if (String(input).endsWith("/v1/sessions")) {
                return Response.json({
                    session: {
                        id: "remote-1",
                        metadata: encodeRemote(sessionKey, { name: "Stale" }),
                        metadataVersion: 3,
                    },
                });
            }
            return Response.json({ hasMore: false, messages: [] });
        });
        const client = new HappySessionClient({
            configuration: configuration(account.publicKey),
            fetch: request,
            repository,
            session: fakeSession([]).session,
            socketFactory: () => socket,
        });
        client.start();

        await waitFor(
            () => socket.emitted.filter(([event]) => event === "update-metadata").length === 2,
        );
        expect(
            socket.emitted
                .filter(([event]) => event === "update-metadata")
                .map(([, value]) => value.expectedVersion),
        ).toEqual([3, 4]);
        const finalUpdate = socket.emitted.filter(([event]) => event === "update-metadata")[1]?.[1];
        expect(
            decryptHappyPayload(sessionKey, "dataKey", Buffer.from(finalUpdate.metadata, "base64")),
        ).toMatchObject({
            archivedBy: "user",
            lifecycleState: "archiveRequested",
            session: { status: "idle" },
        });

        await client.close();
        repository.close();
    });
});

class FakeSocket {
    connected = false;
    emitted: Array<[string, any]> = [];
    listeners = new Map<string, (...arguments_: any[]) => void>();

    constructor(
        private readonly metadataAnswer: (value: any) => unknown = (value) => ({
            result: "success",
            version: Number(value.expectedVersion) + 1,
        }),
    ) {}

    connect(): void {
        this.connected = true;
        this.listeners.get("connect")?.();
    }

    disconnect(): void {}

    emit(event: string, ...values: any[]): void {
        const value = values[0];
        this.emitted.push([event, value]);
        const callback = values.find((candidate) => typeof candidate === "function") as
            | ((answer: unknown) => void)
            | undefined;
        if (event === "update-metadata" && callback) {
            callback(this.metadataAnswer(value));
        }
    }

    on(event: string, listener: (...arguments_: any[]) => void): void {
        this.listeners.set(event, listener);
    }

    requestRpc(request: unknown): Promise<string> {
        return new Promise((resolve) => this.listeners.get("rpc-request")?.(request, resolve));
    }
}

function fakeSession(submitted: unknown[]): {
    abortCalls: number;
    changedModels: unknown[];
    changedPermissionModes: string[];
    session: InMemorySession;
    snapshot: any;
} {
    const submittedIds = new Set<string>();
    const changedModels: unknown[] = [];
    const changedPermissionModes: string[] = [];
    let abortCalls = 0;
    const snapshot: any = {
        agent: { type: "primary" },
        backgroundProcesses: [],
        cwd: "/workspace",
        effort: "high",
        mcpServers: [],
        modelId: "gpt-test",
        modelLocked: false,
        models: [
            {
                defaultThinkingLevel: "high",
                id: "gpt-test",
                name: "GPT Test",
                thinkingLevels: ["low", "high"],
            },
        ],
        permissionMode: "auto",
        providerId: "codex",
        skills: [],
        snapshot: { tools: [] },
        status: "idle",
        tasks: [],
        title: "Test session",
        workflows: [],
    };
    const harness = {
        get abortCalls() {
            return abortCalls;
        },
        changedModels,
        changedPermissionModes,
        session: {
            abort: async () => {
                abortCalls += 1;
                return { aborted: true };
            },
            changeEffort: ({ effort }: { effort: string }) => {
                snapshot.effort = effort;
            },
            changeModel: (request: { effort?: string; modelId: string; providerId?: string }) => {
                changedModels.push(request);
                snapshot.modelId = request.modelId;
                snapshot.providerId = request.providerId ?? snapshot.providerId;
                snapshot.effort = request.effort ?? snapshot.effort;
            },
            changePermissionMode: async ({ permissionMode }: { permissionMode: string }) => {
                changedPermissionModes.push(permissionMode);
                snapshot.permissionMode = permissionMode;
            },
            events: {
                messageSubmission: (id: string) =>
                    submittedIds.has(id)
                        ? { data: { message: { id } }, type: "message_submitted" }
                        : undefined,
                since: () =>
                    [...submittedIds].map((id) => ({
                        data: { message: { id } },
                        type: "message_submitted",
                    })),
            },
            id: "session-1",
            snapshot: () => snapshot,
            submit: (request: { clientSubmissionId: string }) => {
                submitted.push(request);
                submittedIds.add(request.clientSubmissionId);
            },
        } as unknown as InMemorySession,
        snapshot,
    };
    return harness;
}

function encodeRemote(key: Uint8Array, value: unknown): string {
    return Buffer.from(encryptHappyPayload(key, "dataKey", value)).toString("base64");
}

function remoteMessage(id: string, seq: number, content: string): HappyRemoteMessage {
    return {
        content: { c: content, t: "encrypted" },
        createdAt: seq,
        id,
        localId: null,
        seq,
        updatedAt: seq,
    };
}

function deriveBlobKey(key: Uint8Array, variant: "dataKey" | "legacy"): Uint8Array {
    const root = createHmac("sha512", key).update("Happy Blobs Master Seed").digest();
    const path = variant === "dataKey" ? "session" : "master";
    return new Uint8Array(
        createHmac("sha512", root.subarray(32))
            .update(new Uint8Array([0, ...new TextEncoder().encode(path)]))
            .digest()
            .subarray(0, 32),
    );
}

function encryptBlob(data: Uint8Array, key: Uint8Array): Uint8Array {
    const nonce = new Uint8Array(tweetnacl.secretbox.nonceLength).fill(3);
    const encrypted = tweetnacl.secretbox(data, nonce, key);
    return new Uint8Array([...nonce, ...encrypted]);
}

function configuration(publicKey: Uint8Array): HappyConnectionConfiguration {
    return {
        credentials: {
            encryption: {
                machineKey: new Uint8Array(32).fill(10),
                publicKey,
                type: "dataKey",
            },
            token: "token",
        },
        credentialsPath: "/rig/happy/access.key",
        happyHome: "/rig/happy",
        imported: false,
        serverUrl: "https://happy.test",
    };
}

function unwrapDataKey(value: string, accountSecretKey: Uint8Array): Uint8Array | undefined {
    const bundle = new Uint8Array(Buffer.from(value, "base64"));
    if (bundle[0] !== 0) return undefined;
    return (
        tweetnacl.box.open(
            bundle.slice(57),
            bundle.slice(33, 57),
            bundle.slice(1, 33),
            accountSecretKey,
        ) ?? undefined
    );
}

async function createRepository() {
    const directory = await mkdtemp(join(tmpdir(), "rig-happy-client-"));
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

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for Happy synchronization.");
}
