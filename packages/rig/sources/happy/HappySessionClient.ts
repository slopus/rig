import { io, type Socket } from "socket.io-client";

import type { ImageBlock } from "../agent/types.js";
import type { ModelCatalog, SubagentSummary } from "../protocol/index.js";
import type { InMemorySession } from "../server/InMemorySession.js";
import { readPackageVersion } from "../readPackageVersion.js";
import { isPermissionMode } from "../permissions/index.js";
import { createHappySessionMetadata } from "./createHappySessionMetadata.js";
import { decryptHappyBlob } from "./decryptHappyBlob.js";
import { HAPPY_SESSION_RPC_METHODS, handleHappySessionRpc } from "./handleHappySessionRpc.js";
import { decryptHappyPayload, encryptHappyPayload, wrapHappyDataKey } from "./happyEncryption.js";
import { readHappyRemoteInput } from "./readHappyRemoteInput.js";
import type { HappySyncRepository, HappySessionState } from "./HappySyncRepository.js";
import type {
    HappyConnectionConfiguration,
    HappyRemoteMessage,
    HappySessionMetadata,
    HappySessionProtocolMessage,
} from "./types.js";

const SYNC_INTERVAL_MS = 2_000;
const HTTP_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type Fetch = typeof fetch;

interface HappySocket {
    connected?: boolean;
    connect(): void;
    disconnect(): void;
    emit(event: string, ...values: any[]): void;
    on(event: string, listener: (...arguments_: any[]) => void): void;
}

export interface HappySessionClientOptions {
    configuration: HappyConnectionConfiguration;
    fetch?: Fetch;
    getSubagents?: (sessionId: string) => readonly SubagentSummary[];
    modelCatalog?: ModelCatalog;
    repository: HappySyncRepository;
    session: InMemorySession;
    socketFactory?: (url: string, options: Parameters<typeof io>[1]) => HappySocket;
}

export class HappySessionClient {
    readonly #configuration: HappyConnectionConfiguration;
    readonly #fetch: Fetch;
    readonly #getSubagents: NonNullable<HappySessionClientOptions["getSubagents"]>;
    readonly #modelCatalog: ModelCatalog | undefined;
    readonly #repository: HappySyncRepository;
    readonly #session: InMemorySession;
    readonly #socketFactory: NonNullable<HappySessionClientOptions["socketFactory"]>;
    #closed = false;
    readonly #closeController = new AbortController();
    #needsAnotherSync = false;
    #lastMetadata: string | undefined;
    #metadataBase: Record<string, unknown> = {};
    #metadataVersion: number | undefined;
    readonly #pendingAttachments = new Map<string, Promise<ImageBlock | undefined>>();
    #socket: HappySocket | undefined;
    #summaryTitle: string | undefined;
    #summaryUpdatedAt = Date.now();
    #syncPromise: Promise<void> | undefined;
    #timer: NodeJS.Timeout | undefined;

    constructor(options: HappySessionClientOptions) {
        this.#configuration = options.configuration;
        this.#fetch = options.fetch ?? fetch;
        this.#getSubagents = options.getSubagents ?? (() => []);
        this.#modelCatalog = options.modelCatalog;
        this.#repository = options.repository;
        this.#session = options.session;
        this.#socketFactory =
            options.socketFactory ?? ((url, socketOptions) => io(url, socketOptions) as Socket);
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        this.#closeController.abort();
        if (this.#timer !== undefined) clearInterval(this.#timer);
        const remoteSessionId = this.#repository.getSession(this.#session.id)?.remoteSessionId;
        if (remoteSessionId !== undefined) {
            this.#socket?.emit("session-end", { sid: remoteSessionId, time: Date.now() });
        }
        this.#socket?.disconnect();
        this.#socket = undefined;
        await this.#syncPromise?.catch(() => undefined);
    }

    enqueue(messages: readonly HappySessionProtocolMessage[]): void {
        this.#repository.enqueue(this.#session.id, messages);
        this.kick();
    }

    kick(): void {
        if (this.#closed) return;
        if (this.#syncPromise !== undefined) {
            this.#needsAnotherSync = true;
            return;
        }
        this.#syncPromise = this.#runSyncLoop().finally(() => {
            this.#syncPromise = undefined;
        });
    }

    start(): void {
        if (this.#closed || this.#timer !== undefined) return;
        this.#timer = setInterval(() => this.kick(), SYNC_INTERVAL_MS);
        this.#timer.unref();
        this.kick();
    }

    async #runSyncLoop(): Promise<void> {
        do {
            this.#needsAnotherSync = false;
            try {
                const state = await this.#ensureRemoteSession();
                if (state === undefined || this.#closed) return;
                this.#ensureSocket(state.remoteSessionId!);
                await this.#flushOutbox(state);
                await this.#fetchIncoming(state);
                await this.#syncMetadata(state);
                this.#sendKeepAlive(state.remoteSessionId!);
            } catch {
                // Happy is optional. The durable outbox and periodic sync retain work for retry.
            }
        } while (this.#needsAnotherSync && !this.#closed);
    }

    async #ensureRemoteSession(): Promise<HappySessionState | undefined> {
        const current = this.#repository.getSession(this.#session.id);
        if (current === undefined) return undefined;
        if (this.#metadataVersion !== undefined && current.remoteSessionId !== undefined) {
            return current;
        }

        const metadata = this.#metadata();
        const encodedMetadata = encodePayload(current, metadata);
        const wrappedKey =
            this.#configuration.credentials.encryption.type === "dataKey"
                ? Buffer.from(
                      wrapHappyDataKey(
                          current.encryptionKey,
                          this.#configuration.credentials.encryption.publicKey,
                      ),
                  ).toString("base64")
                : null;
        const response = await this.#request(`${this.#configuration.serverUrl}/v1/sessions`, {
            body: JSON.stringify({
                agentState: null,
                dataEncryptionKey: wrappedKey,
                metadata: encodedMetadata,
                tag: current.tag,
            }),
            method: "POST",
        });
        const body = (await response.json()) as unknown;
        const remote = readRemoteSession(body);
        const remoteSessionId = remote.id;
        this.#metadataVersion = remote.metadataVersion;
        if (remote.metadata !== undefined) {
            const decoded = decodePayload(current, remote.metadata);
            if (isRecord(decoded)) this.#metadataBase = decoded;
        }
        if (remote.metadata === encodedMetadata) {
            this.#lastMetadata = JSON.stringify(metadata);
            this.#metadataBase = { ...metadata };
        }
        this.#repository.setRemoteSession(this.#session.id, remoteSessionId);
        return this.#repository.getSession(this.#session.id);
    }

    #ensureSocket(remoteSessionId: string): void {
        if (this.#socket !== undefined) return;
        const socket = this.#socketFactory(this.#configuration.serverUrl, {
            auth: {
                clientType: "session-scoped",
                happyClient: `rig/${readPackageVersion()}`,
                sessionId: remoteSessionId,
                token: this.#configuration.credentials.token,
            },
            autoConnect: false,
            path: "/v1/updates",
            reconnection: true,
            transports: ["websocket"],
            withCredentials: true,
        });
        socket.on("connect", () => {
            for (const method of HAPPY_SESSION_RPC_METHODS) {
                socket.emit("rpc-register", { method: `${remoteSessionId}:${method}` });
            }
            this.kick();
        });
        socket.on(
            "rpc-request",
            (request: unknown, callback: (response: string) => void) =>
                void this.#handleRpcRequest(remoteSessionId, request, callback),
        );
        socket.on("update", () => this.kick());
        this.#socket = socket;
        socket.connect();
    }

    async #flushOutbox(state: HappySessionState): Promise<void> {
        while (!this.#closed) {
            const pending = this.#repository.pending(this.#session.id, 50);
            if (pending.length === 0) return;
            await this.#request(
                `${this.#configuration.serverUrl}/v3/sessions/${encodeURIComponent(state.remoteSessionId!)}/messages`,
                {
                    body: JSON.stringify({
                        messages: pending.map((message) => ({
                            content: encodePayload(state, message),
                            localId: message.localId,
                        })),
                    }),
                    method: "POST",
                },
            );
            this.#repository.acknowledge(
                this.#session.id,
                pending.map((message) => message.localId),
            );
        }
    }

    async #fetchIncoming(state: HappySessionState): Promise<void> {
        let afterSequence = this.#repository.getSession(this.#session.id)?.lastRemoteSeq ?? 0;
        while (!this.#closed) {
            const url = new URL(
                `${this.#configuration.serverUrl}/v3/sessions/${encodeURIComponent(state.remoteSessionId!)}/messages`,
            );
            url.searchParams.set("after_seq", String(afterSequence));
            url.searchParams.set("limit", String(PAGE_SIZE));
            const response = await this.#request(url.toString());
            const body = (await response.json()) as unknown;
            const page = readRemoteMessagePage(body);
            let maximumSequence = afterSequence;
            for (const message of page.messages) {
                const canCommit = await this.#handleRemoteMessage(state, message);
                maximumSequence = Math.max(maximumSequence, message.seq);
                if (canCommit) {
                    this.#repository.updateLastRemoteSeq(this.#session.id, maximumSequence);
                }
            }
            if (!page.hasMore || maximumSequence === afterSequence) return;
            afterSequence = maximumSequence;
        }
    }

    async #handleRemoteMessage(
        state: HappySessionState,
        message: HappyRemoteMessage,
    ): Promise<boolean> {
        const decrypted = decryptHappyPayload(
            state.encryptionKey,
            state.encryptionVariant,
            new Uint8Array(Buffer.from(message.content.c, "base64")),
        );
        const incoming = readHappyRemoteInput(decrypted);
        if (incoming === undefined || incoming.kind === "echo") {
            return this.#pendingAttachments.size === 0;
        }
        if (incoming.kind === "attachment") {
            if (!this.#pendingAttachments.has(message.id)) {
                this.#pendingAttachments.set(
                    message.id,
                    this.#downloadAttachment(state, incoming).catch(() => undefined),
                );
            }
            return false;
        }
        const messageId = `happy:${message.id}`;
        const attachments = await Promise.all(this.#pendingAttachments.values());
        this.#pendingAttachments.clear();
        if (hasSubmittedMessage(this.#session, messageId)) return true;
        await this.#applySelection(incoming.meta);
        const imageBlocks = attachments.filter(
            (attachment): attachment is ImageBlock => attachment !== undefined,
        );
        const content = [
            ...(incoming.text.length === 0
                ? []
                : ([{ text: incoming.text, type: "text" }] as const)),
            ...imageBlocks,
        ];
        const request = {
            clientSubmissionId: messageId,
            ...(imageBlocks.length === 0 ? {} : { content }),
            displayText: incoming.text,
            text: incoming.text,
        };
        if (this.#session.snapshot().status === "running") {
            try {
                this.#session.steer(request);
                return true;
            } catch {
                // The run may have completed between the snapshot and delivery.
            }
        }
        this.#session.submit(request);
        return true;
    }

    async #applySelection(selection: {
        effort?: string;
        modelId?: string;
        permissionMode?: string;
        providerId?: string;
    }): Promise<void> {
        if (isPermissionMode(selection.permissionMode)) {
            try {
                await this.#session.changePermissionMode({
                    permissionMode: selection.permissionMode,
                });
            } catch {
                // A stale or unknown mobile mode must not prevent message delivery.
            }
        }
        if (this.#session.snapshot().status === "running") return;
        try {
            if (selection.modelId !== undefined && selection.modelId !== "default") {
                this.#session.changeModel({
                    ...(selection.effort === undefined ? {} : { effort: selection.effort }),
                    modelId: selection.modelId,
                    ...(selection.providerId === undefined
                        ? {}
                        : { providerId: selection.providerId }),
                });
            } else if (selection.effort !== undefined) {
                this.#session.changeEffort({ effort: selection.effort });
            }
        } catch {
            // A stale mobile selection must not prevent delivery of the user's message.
        }
    }

    async #downloadAttachment(
        state: HappySessionState,
        attachment: { mimeType?: string; name: string; ref: string; size: number },
    ): Promise<ImageBlock | undefined> {
        if (attachment.size < 0 || attachment.size > MAX_ATTACHMENT_BYTES) return undefined;
        const remoteSessionId = state.remoteSessionId;
        if (remoteSessionId === undefined) return undefined;
        const response = await this.#request(
            `${this.#configuration.serverUrl}/v1/sessions/${encodeURIComponent(remoteSessionId)}/attachments/request-download`,
            { body: JSON.stringify({ ref: attachment.ref }), method: "POST" },
        );
        const body = (await response.json()) as unknown;
        if (!isRecord(body) || typeof body.downloadUrl !== "string") return undefined;
        const downloadUrl = body.downloadUrl;
        const sameServer =
            new URL(downloadUrl).origin === new URL(this.#configuration.serverUrl).origin;
        const download = await this.#fetch(downloadUrl, {
            ...(sameServer
                ? { headers: { Authorization: `Bearer ${this.#configuration.credentials.token}` } }
                : {}),
            signal: AbortSignal.any([
                AbortSignal.timeout(HTTP_TIMEOUT_MS),
                this.#closeController.signal,
            ]),
        });
        if (!download.ok) return undefined;
        const encrypted = new Uint8Array(await download.arrayBuffer());
        if (encrypted.length > MAX_ATTACHMENT_BYTES + 64) return undefined;
        const decrypted = decryptHappyBlob({
            bundle: encrypted,
            encryptionKey: state.encryptionKey,
            encryptionVariant: state.encryptionVariant,
        });
        if (decrypted === undefined || decrypted.length > MAX_ATTACHMENT_BYTES) return undefined;
        const mediaType = attachment.mimeType ?? "image/jpeg";
        if (!mediaType.startsWith("image/")) return undefined;
        return { data: Buffer.from(decrypted).toString("base64"), mediaType, type: "image" };
    }

    async #handleRpcRequest(
        remoteSessionId: string,
        request: unknown,
        callback: (response: string) => void,
    ): Promise<void> {
        const state = this.#repository.getSession(this.#session.id);
        if (state === undefined) {
            callback("");
            return;
        }
        let response: unknown;
        try {
            if (!isRecord(request) || typeof request.method !== "string") {
                response = { error: "Method not found" };
            } else if (typeof request.params !== "string") {
                response = { error: "Invalid request" };
            } else {
                const params = decryptHappyPayload(
                    state.encryptionKey,
                    state.encryptionVariant,
                    new Uint8Array(Buffer.from(request.params, "base64")),
                );
                const prefix = `${remoteSessionId}:`;
                if (!request.method.startsWith(prefix) || params === undefined) {
                    response = { error: "Invalid request" };
                } else {
                    response = await handleHappySessionRpc({
                        abort: () => this.#session.abort(),
                        context: () => this.#session.externalControlContext(),
                        method: request.method.slice(prefix.length),
                        params,
                    });
                }
            }
        } catch (error) {
            response = { error: error instanceof Error ? error.message : "Abort failed" };
        }
        callback(encodePayload(state, response));
    }

    async #syncMetadata(state: HappySessionState): Promise<void> {
        if (
            this.#socket === undefined ||
            this.#socket.connected === false ||
            this.#metadataVersion === undefined
        ) {
            return;
        }
        const rigMetadata = this.#metadata();
        let metadata = { ...this.#metadataBase, ...rigMetadata };
        let serialized = JSON.stringify(metadata);
        if (serialized === this.#lastMetadata) return;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const answer = await this.#emitWithAck("update-metadata", {
                expectedVersion: this.#metadataVersion,
                metadata: encodePayload(state, metadata),
                sid: state.remoteSessionId,
            });
            if (!isRecord(answer)) throw new Error("Happy returned an invalid metadata response.");
            if (answer.result === "success" && typeof answer.version === "number") {
                this.#metadataVersion = answer.version;
                this.#lastMetadata = serialized;
                this.#metadataBase = metadata;
                return;
            }
            if (answer.result === "version-mismatch" && typeof answer.version === "number") {
                if (typeof answer.metadata !== "string") {
                    throw new Error("Happy returned incomplete metadata after a version conflict.");
                }
                const latest = decodePayload(state, answer.metadata);
                if (!isRecord(latest)) {
                    throw new Error("Happy returned invalid metadata after a version conflict.");
                }
                this.#metadataVersion = answer.version;
                this.#metadataBase = latest;
                metadata = { ...latest, ...rigMetadata };
                serialized = JSON.stringify(metadata);
                continue;
            }
            throw new Error("Happy rejected the metadata update.");
        }
        throw new Error("Happy metadata changed concurrently.");
    }

    #emitWithAck(event: string, value: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const finish = (operation: () => void) => {
                clearTimeout(timer);
                this.#closeController.signal.removeEventListener("abort", onAbort);
                operation();
            };
            const onAbort = () => finish(() => reject(new Error("Happy synchronization closed.")));
            const timer = setTimeout(
                () => finish(() => reject(new Error("Happy socket acknowledgement timed out."))),
                HTTP_TIMEOUT_MS,
            );
            timer.unref();
            this.#closeController.signal.addEventListener("abort", onAbort, { once: true });
            this.#socket!.emit(event, value, (answer: unknown) => {
                finish(() => resolve(answer));
            });
        });
    }

    #metadata(): HappySessionMetadata {
        const snapshot = this.#session.snapshot();
        const title = snapshot.title ?? "Rig session";
        if (title !== this.#summaryTitle) {
            this.#summaryTitle = title;
            this.#summaryUpdatedAt = Date.now();
        }
        return createHappySessionMetadata({
            configuration: this.#configuration,
            ...(this.#modelCatalog === undefined ? {} : { modelCatalog: this.#modelCatalog }),
            session: snapshot,
            subagents: this.#getSubagents(this.#session.id),
            summaryUpdatedAt: this.#summaryUpdatedAt,
        });
    }

    #sendKeepAlive(remoteSessionId: string): void {
        this.#socket?.emit("session-alive", {
            sid: remoteSessionId,
            thinking: this.#session.snapshot().status === "running",
            time: Date.now(),
        });
    }

    async #request(url: string, init: RequestInit = {}): Promise<Response> {
        const signal = AbortSignal.any([
            AbortSignal.timeout(HTTP_TIMEOUT_MS),
            this.#closeController.signal,
        ]);
        const response = await this.#fetch(url, {
            ...init,
            headers: {
                Authorization: `Bearer ${this.#configuration.credentials.token}`,
                "Content-Type": "application/json",
                "X-Happy-Client": `rig/${readPackageVersion()}`,
                ...init.headers,
            },
            signal,
        });
        if (!response.ok) throw new Error(`Happy returned HTTP ${String(response.status)}.`);
        return response;
    }
}

function encodePayload(state: HappySessionState, value: unknown): string {
    return Buffer.from(
        encryptHappyPayload(state.encryptionKey, state.encryptionVariant, value),
    ).toString("base64");
}

function decodePayload(state: HappySessionState, value: string): unknown {
    return decryptHappyPayload(
        state.encryptionKey,
        state.encryptionVariant,
        new Uint8Array(Buffer.from(value, "base64")),
    );
}

function readRemoteSession(value: unknown): {
    id: string;
    metadata?: string;
    metadataVersion: number;
} {
    const session = isRecord(value) && isRecord(value.session) ? value.session : undefined;
    if (
        session === undefined ||
        typeof session.id !== "string" ||
        typeof session.metadataVersion !== "number"
    ) {
        throw new Error("Happy returned an invalid session.");
    }
    return {
        id: session.id,
        ...(typeof session.metadata === "string" ? { metadata: session.metadata } : {}),
        metadataVersion: session.metadataVersion,
    };
}

function readRemoteMessagePage(value: unknown): {
    hasMore: boolean;
    messages: HappyRemoteMessage[];
} {
    if (!isRecord(value) || !Array.isArray(value.messages)) {
        throw new Error("Happy returned an invalid message page.");
    }
    return {
        hasMore: value.hasMore === true,
        messages: value.messages.filter(isHappyRemoteMessage),
    };
}

function isHappyRemoteMessage(value: unknown): value is HappyRemoteMessage {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        typeof value.seq === "number" &&
        isRecord(value.content) &&
        value.content.t === "encrypted" &&
        typeof value.content.c === "string"
    );
}

function hasSubmittedMessage(session: InMemorySession, messageId: string): boolean {
    return session.events.messageSubmission(messageId) !== undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
