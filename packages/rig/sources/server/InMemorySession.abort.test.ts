import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CreateCodingAssistantAgentOptions } from "../app/createCodingAssistantAgent.js";
import type { CodingAssistantRuntime } from "../app/CodingAssistantRuntime.js";
import { NativeProxessManager } from "../processes/index.js";
import { createEventIdFactory, type ModelCatalog } from "../protocol/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
    type InferenceStream,
} from "../providers/types.js";
import { InMemorySession } from "./InMemorySession.js";
import type { AgentSessionManager } from "./AgentSessionManager.js";

describe("InMemorySession abort", () => {
    it("pauses active descendants even when the parent has no active run", async () => {
        const pauseDescendants = vi.fn(async () => 2);
        const session = new InMemorySession({
            agentManager: { pauseDescendants } as unknown as AgentSessionManager,
            createEventId: createEventIdFactory(),
            modelCatalog: testCatalog(),
            request: {
                cwd: "/tmp/rig-parent-abort-test",
                modelId: "test/parent-abort",
                providerId: "test",
            },
        });

        await expect(session.abort()).resolves.toEqual({ aborted: true });
        expect(pauseDescendants).toHaveBeenCalledWith(session.id);
    });

    it("stops tracked processes even after the agent run is already idle", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "rig-idle-abort-"));
        try {
            const marker = join(cwd, "delayed-action.txt");
            const model = defineModel({
                defaultThinkingLevel: "off",
                id: "test/idle-abort",
                name: "Idle abort",
                thinkingLevels: ["off"],
            });
            const provider = defineProvider({
                id: "test",
                models: [model],
                stream: () => responseStream("Turn complete."),
            });
            const catalog: ModelCatalog = {
                defaultModelId: model.id,
                defaultProviderId: provider.id,
                models: [model],
                providers: [{ providerId: provider.id, models: [model] }],
            };
            let processManager: NativeProxessManager | undefined;
            const session = new InMemorySession({
                createEventId: createEventIdFactory(),
                createRuntime(options) {
                    const runtime = createRuntime(options, provider);
                    processManager = runtime.processManager;
                    return runtime;
                },
                modelCatalog: catalog,
                request: { cwd, modelId: model.id, providerId: provider.id },
            });

            const submitted = session.submit({ text: "Finish before the delayed action." });
            await expect(session.waitForRun(submitted.runId)).resolves.toEqual({
                status: "completed",
            });
            if (processManager === undefined) throw new Error("Runtime was not created.");

            processManager.start({
                command: `${shellQuote(process.execPath)} -e ${shellQuote(
                    `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "escaped"), 500);`,
                )}`,
                cwd,
                maxOutputBytes: 4_096,
            });
            expect(processManager.activeCount()).toBe(1);

            await expect(session.abort()).resolves.toEqual({
                aborted: false,
                stoppedProcesses: 1,
            });
            expect(processManager.activeCount()).toBe(0);
            await delay(700);
            await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
        } finally {
            await rm(cwd, { force: true, recursive: true });
        }
    });

    it("continues the same run immediately when aborting with pending steering", async () => {
        const started = deferred<void>();
        const contexts: Context[] = [];
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/pending-steering-continuation",
            name: "Pending steering continuation",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, context, options) {
                contexts.push(context);
                if (contexts.length === 1) {
                    return abortableStream(options?.signal, started.resolve);
                }
                return responseStream("Continued immediately.");
            },
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: provider.id,
            models: [model],
            providers: [{ models: [model], providerId: provider.id }],
        };
        const session = new InMemorySession({
            createEventId: createEventIdFactory(),
            createRuntime: (options) => createRuntime(options, provider),
            modelCatalog: catalog,
            request: { cwd: "/tmp/rig-steering-continuation", modelId: model.id },
        });

        const submitted = session.submit({ text: "Start waiting." });
        await started.promise;
        session.steer({ text: "Apply this pending direction." });

        await expect(
            session.abort({ continuePendingSteering: true, pauseDescendants: false }),
        ).resolves.toMatchObject({ aborted: true, continued: true });
        await expect(session.waitForRun(submitted.runId)).resolves.toEqual({
            status: "completed",
        });

        expect(contexts).toHaveLength(2);
        const continuedUserText = contexts[1]?.messages.flatMap((message) =>
            message.role === "user" && Array.isArray(message.content)
                ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
                : [],
        );
        expect(
            continuedUserText?.filter((text) => text === "Apply this pending direction."),
        ).toHaveLength(1);
        const events = session.events.since(undefined) ?? [];
        expect(events.filter((event) => event.type === "steering_applied")).toHaveLength(1);
        expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    });

    it("stops normally when pending-aware abort finds no steering for the active run", async () => {
        const started = deferred<void>();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/no-pending-steering",
            name: "No pending steering",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, _context, options) {
                return abortableStream(options?.signal, started.resolve);
            },
        });
        const session = new InMemorySession({
            createEventId: createEventIdFactory(),
            createRuntime: (options) => createRuntime(options, provider),
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: provider.id,
                models: [model],
                providers: [{ models: [model], providerId: provider.id }],
            },
            request: { cwd: "/tmp/rig-no-pending-steering", modelId: model.id },
        });

        const submitted = session.submit({ text: "Start waiting without steering." });
        await started.promise;

        await expect(
            session.abort({ continuePendingSteering: true, pauseDescendants: false }),
        ).resolves.toMatchObject({ aborted: true });
        await expect(session.waitForRun(submitted.runId)).resolves.toEqual({ status: "aborted" });
        expect(
            (session.events.since(undefined) ?? []).filter(
                (event) => event.type === "steering_applied",
            ),
        ).toHaveLength(0);
    });

    it("aborts compaction without overwriting the repaired shutdown state", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/shutdown-compaction",
            name: "Shutdown compaction",
            thinkingLevels: ["off"],
        });
        let compactStartedResolve: (() => void) | undefined;
        const compactStarted = new Promise<void>((resolve) => {
            compactStartedResolve = resolve;
        });
        let streamCount = 0;
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream: (_model, _context, options) => {
                streamCount += 1;
                if (streamCount === 1) return responseStream("Earlier answer");
                compactStartedResolve?.();
                return abortedStream(options?.signal);
            },
        });
        const session = new InMemorySession({
            createEventId: createEventIdFactory(),
            createRuntime: (options) => createRuntime(options, provider),
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: provider.id,
                models: [model],
                providers: [{ models: [model], providerId: provider.id }],
            },
            request: {
                cwd: "/tmp/rig-compaction-shutdown-test",
                modelId: model.id,
                providerId: provider.id,
            },
        });

        const submitted = session.submit({ text: "Earlier request" });
        await session.waitForRun(submitted.runId);
        const compacting = session.compact();
        await compactStarted;
        const shutdown = session.beginShutdown();
        session.markInterrupted({
            interruptedAt: 1,
            message: "The local daemon shut down during compaction.",
            reason: "shutdown",
        });

        await expect(compacting).rejects.toThrow("compaction was stopped");
        await expect(shutdown).resolves.toBeUndefined();
        expect(session.summary()).toMatchObject({
            interruption: { reason: "shutdown" },
            status: "error",
        });
    });
});

function testCatalog(): ModelCatalog {
    const model = defineModel({
        defaultThinkingLevel: "off",
        id: "test/parent-abort",
        name: "Parent abort",
        thinkingLevels: ["off"],
    });
    return {
        defaultModelId: model.id,
        defaultProviderId: "test",
        models: [model],
        providers: [{ models: [model], providerId: "test" }],
    };
}

function createRuntime(
    options: CreateCodingAssistantAgentOptions,
    provider: ReturnType<typeof defineProvider>,
): CodingAssistantRuntime {
    const processManager = new NativeProxessManager();
    const context = createNodeAgentContext({ cwd: options.cwd, processManager });
    return {
        agent: new Agent({
            context,
            modelId: options.modelId ?? provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: [],
        }),
        context,
        cwd: options.cwd,
        processManager,
        provider,
    };
}

function responseStream(text: string): InferenceStream {
    const message = assistantMessage(text, "test/idle-abort");
    return {
        async *[Symbol.asyncIterator]() {
            yield { partial: message, type: "start" as const };
            yield { message, reason: "stop" as const, type: "done" as const };
        },
        async result() {
            return message;
        },
    };
}

function assistantMessage(text: string, model: string): AssistantMessage {
    return {
        api: "test",
        content: [{ text, type: "text" }],
        model,
        provider: "test",
        role: "assistant",
        stopReason: "stop",
        timestamp: 1,
        usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: {
                cacheRead: 0,
                cacheWrite: 0,
                input: 0,
                output: 0,
                total: 0,
            },
            input: 0,
            output: 0,
            totalTokens: 0,
        },
    };
}

function abortedStream(signal: AbortSignal | undefined): InferenceStream {
    const message = assistantMessage("", "test/shutdown-compaction");
    return {
        async *[Symbol.asyncIterator]() {
            yield { partial: message, type: "start" as const };
            await new Promise<void>((_resolve, reject) => {
                const abort = () => reject(new Error("Conversation compaction was stopped."));
                signal?.addEventListener("abort", abort, { once: true });
                if (signal?.aborted) abort();
            });
        },
        async result() {
            return message;
        },
    };
}

function abortableStream(signal: AbortSignal | undefined, onStart: () => void): InferenceStream {
    return {
        async *[Symbol.asyncIterator]() {
            onStart();
            await new Promise<void>((resolve) => {
                if (signal?.aborted) {
                    resolve();
                    return;
                }
                signal?.addEventListener("abort", () => resolve(), { once: true });
            });
            throw new Error("aborted");
        },
        async result() {
            throw new Error("aborted");
        },
    };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
