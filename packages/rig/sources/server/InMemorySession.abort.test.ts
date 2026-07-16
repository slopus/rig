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
        session.steer({
            clientSubmissionId: "client-pending-steering",
            text: "Apply this pending direction.",
        });

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
        expect(
            events.find(
                (event) => event.type === "message_submitted" && event.data.delivery === "steer",
            ),
        ).toMatchObject({ data: { message: { id: "client-pending-steering" } } });
        expect(events.filter((event) => event.type === "steering_applied")).toHaveLength(1);
        expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    });

    it("coalesces overlapping interrupts and retains steering submitted during settlement", async () => {
        const started = deferred<void>();
        const releaseDescendants = deferred<number>();
        const contexts: Context[] = [];
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/coalesced-steering-continuation",
            name: "Coalesced steering continuation",
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
                return responseStream("Continued once.");
            },
        });
        let session: InMemorySession;
        const pauseDescendants = vi.fn(() => {
            session.recordSubagentsSuspended([
                { description: "Only child", path: "/root/only_child" },
            ]);
            return releaseDescendants.promise;
        });
        session = new InMemorySession({
            agentManager: { pauseDescendants } as unknown as AgentSessionManager,
            createEventId: createEventIdFactory(),
            createRuntime: (options) => createRuntime(options, provider),
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: provider.id,
                models: [model],
                providers: [{ models: [model], providerId: provider.id }],
            },
            request: { cwd: "/tmp/rig-coalesced-steering", modelId: model.id },
        });

        const submitted = session.submit({ text: "Start waiting." });
        await started.promise;
        session.steer({ text: "First pending direction." });

        const firstAbort = session.abort({ continuePendingSteering: true });
        const secondAbort = session.abort({ continuePendingSteering: true });
        expect(secondAbort).toBe(firstAbort);
        expect(pauseDescendants).toHaveBeenCalledOnce();
        session.steer({ text: "Submitted while interrupt settles." });
        releaseDescendants.resolve(1);

        await expect(Promise.all([firstAbort, secondAbort])).resolves.toEqual([
            expect.objectContaining({ aborted: true, continued: true }),
            expect.objectContaining({ aborted: true, continued: true }),
        ]);
        await expect(session.waitForRun(submitted.runId)).resolves.toEqual({
            status: "completed",
        });

        expect(contexts).toHaveLength(2);
        const continuedText = contexts[1]?.messages.flatMap((message) =>
            message.role === "user" && Array.isArray(message.content)
                ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
                : [],
        );
        expect(continuedText?.filter((text) => text === "First pending direction.")).toHaveLength(
            1,
        );
        expect(
            continuedText?.filter((text) => text === "Submitted while interrupt settles."),
        ).toHaveLength(1);
        const events = session.events.since(undefined) ?? [];
        expect(events.filter((event) => event.type === "abort_requested")).toHaveLength(1);
        expect(events.filter((event) => event.type === "subagents_suspended")).toHaveLength(1);
        expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
        const appliedIds = events.flatMap((event) =>
            event.type === "steering_applied" ? event.data.messageIds : [],
        );
        expect(new Set(appliedIds).size).toBe(2);
        expect(appliedIds).toHaveLength(2);
    });

    it("does not steer or abort a replacement run when the expected run already finished", async () => {
        const replacementStarted = deferred<void>();
        let streams = 0;
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/targeted-abort",
            name: "Targeted abort",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, _context, options) {
                streams += 1;
                return streams === 1
                    ? responseStream("First run finished.")
                    : abortableStream(options?.signal, replacementStarted.resolve);
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
            request: { cwd: "/tmp/rig-targeted-abort", modelId: model.id },
        });

        const first = session.submit({ text: "Finish first." });
        await expect(session.waitForRun(first.runId)).resolves.toEqual({ status: "completed" });
        const replacement = session.submit({ text: "Keep replacement running." });
        await replacementStarted.promise;

        expect(() =>
            session.steer({
                expectedRunId: first.runId,
                text: "Do not apply this to the replacement.",
            }),
        ).toThrow("The intended run is no longer active.");
        await expect(session.abort({ expectedRunId: first.runId })).resolves.toEqual({
            aborted: false,
        });
        expect(session.summary()).toMatchObject({ status: "running" });
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "abort_requested"),
        ).toHaveLength(0);
        expect(
            session.events
                .since(undefined)
                ?.filter(
                    (event) =>
                        event.type === "message_submitted" && event.data.delivery === "steer",
                ),
        ).toHaveLength(0);

        await expect(session.abort({ expectedRunId: replacement.runId })).resolves.toMatchObject({
            aborted: true,
        });
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
