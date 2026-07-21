import { createHash } from "node:crypto";

import type { ModelCatalog, SessionEvent, SubagentSummary } from "../protocol/index.js";
import type { InMemorySession } from "../server/InMemorySession.js";
import { HappySessionClient, type HappySessionClientOptions } from "./HappySessionClient.js";
import { HappySyncOutboxFullError, HappySyncRepository } from "./HappySyncRepository.js";
import { mapSessionEventToHappyMessages } from "./mapSessionEventToHappyMessages.js";
import type { HappyConnectionConfiguration } from "./types.js";

const MAX_BACKFILLED_MESSAGES = 10_000;
const ATTACH_RETRY_DELAY_MS = 5_000;

export interface HappySyncServiceOptions {
    configuration: HappyConnectionConfiguration;
    databasePath: string;
    fetch?: typeof fetch;
    getSubagents?: (sessionId: string) => readonly SubagentSummary[];
    modelCatalog?: ModelCatalog;
    socketFactory?: HappySessionClientOptions["socketFactory"];
}

export class HappySyncService {
    readonly #attachRetryAfter = new Map<string, number>();
    readonly #backfillTimers = new Map<string, NodeJS.Timeout>();
    readonly #clients = new Map<string, HappySessionClient>();
    readonly #configuration: HappyConnectionConfiguration;
    readonly #credentialFingerprint: string;
    readonly #fetch: typeof fetch | undefined;
    readonly #getSubagents: NonNullable<HappySyncServiceOptions["getSubagents"]>;
    readonly #modelCatalog: ModelCatalog | undefined;
    readonly #repository: HappySyncRepository;
    readonly #socketFactory: HappySessionClientOptions["socketFactory"];

    constructor(options: HappySyncServiceOptions) {
        this.#configuration = options.configuration;
        this.#credentialFingerprint = fingerprint(options.configuration);
        this.#fetch = options.fetch;
        this.#getSubagents = options.getSubagents ?? (() => []);
        this.#modelCatalog = options.modelCatalog;
        this.#repository = new HappySyncRepository(options.databasePath);
        this.#socketFactory = options.socketFactory;
    }

    attach(session: InMemorySession): void {
        if (session.snapshot().agent.type !== "primary") return;
        let client = this.#clients.get(session.id);
        if (client === undefined) {
            if ((this.#attachRetryAfter.get(session.id) ?? 0) > Date.now()) return;
            try {
                const encryption = this.#configuration.credentials.encryption;
                this.#repository.ensureSession({
                    credentialFingerprint: this.#credentialFingerprint,
                    ...(encryption.type === "legacy" ? { encryptionKey: encryption.secret } : {}),
                    encryptionVariant: encryption.type,
                    sessionId: session.id,
                });
                client = new HappySessionClient({
                    configuration: this.#configuration,
                    ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
                    getSubagents: this.#getSubagents,
                    ...(this.#modelCatalog === undefined
                        ? {}
                        : { modelCatalog: this.#modelCatalog }),
                    repository: this.#repository,
                    session,
                    ...(this.#socketFactory === undefined
                        ? {}
                        : { socketFactory: this.#socketFactory }),
                });
                this.#clients.set(session.id, client);
                client.enqueue(backfillMessages(session));
                client.start();
                this.#attachRetryAfter.delete(session.id);
            } catch (error) {
                this.#clients.delete(session.id);
                this.#attachRetryAfter.set(session.id, Date.now() + ATTACH_RETRY_DELAY_MS);
                void client?.close().catch(() => undefined);
                console.error(
                    `Happy sync could not attach session '${session.id}': ${String(error)}`,
                );
            }
        }
    }

    async close(): Promise<void> {
        for (const timer of this.#backfillTimers.values()) clearTimeout(timer);
        this.#backfillTimers.clear();
        this.#attachRetryAfter.clear();
        const results = await Promise.allSettled(
            [...this.#clients.values()].map((client) => client.close()),
        );
        this.#clients.clear();
        this.#repository.close();
        const failure = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failure !== undefined) throw failure.reason;
    }

    observe(event: SessionEvent, session: InMemorySession | undefined): void {
        if (session === undefined || session.snapshot().agent.type !== "primary") return;
        try {
            this.attach(session);
            this.#clients.get(session.id)?.enqueue(mapSessionEventToHappyMessages(event));
        } catch (error) {
            const client = this.#clients.get(session.id);
            if (error instanceof HappySyncOutboxFullError) {
                this.#scheduleBackfill(session);
            } else if (client !== undefined && this.#clients.get(session.id) === client) {
                this.#clients.delete(session.id);
                this.#attachRetryAfter.set(session.id, Date.now() + ATTACH_RETRY_DELAY_MS);
                void client.close().catch(() => undefined);
            }
            console.error(`Happy sync could not observe session '${session.id}': ${String(error)}`);
        }
    }

    #scheduleBackfill(session: InMemorySession): void {
        if (this.#backfillTimers.has(session.id)) return;
        const timer = setTimeout(() => {
            this.#backfillTimers.delete(session.id);
            const client = this.#clients.get(session.id);
            if (client === undefined) {
                this.attach(session);
                return;
            }
            try {
                client.enqueue(backfillMessages(session));
            } catch (error) {
                this.#scheduleBackfill(session);
                console.error(
                    `Happy sync could not recover session '${session.id}': ${String(error)}`,
                );
            }
        }, ATTACH_RETRY_DELAY_MS);
        timer.unref();
        this.#backfillTimers.set(session.id, timer);
    }
}

function backfillMessages(session: InMemorySession) {
    return (session.events.since(undefined) ?? [])
        .slice(-MAX_BACKFILLED_MESSAGES)
        .flatMap(mapSessionEventToHappyMessages)
        .slice(-MAX_BACKFILLED_MESSAGES);
}

function fingerprint(configuration: HappyConnectionConfiguration): string {
    const encryption = configuration.credentials.encryption;
    const key = encryption.type === "legacy" ? encryption.secret : encryption.publicKey;
    return createHash("sha256")
        .update(configuration.serverUrl)
        .update(encryption.type)
        .update(key)
        .digest("hex");
}
