import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CodingAssistantRuntime } from "../runtime/CodingAssistantRuntime.js";
import type { CreateCodingAssistantAgentOptions } from "../runtime/createCodingAssistantAgent.js";
import { NativeProcessManager } from "../processes/index.js";
import { createEventIdFactory, type ModelCatalog } from "../protocol/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
    type InferenceStream,
} from "@slopus/rig-execution";
import { InMemorySession } from "./InMemorySession.js";
import type { AgentSessionManager } from "./AgentSessionManager.js";
import { TrackedTaskDrain } from "./TrackedTaskDrain.js";

describe("InMemorySession abort", () => {
    it("kills a direct shell watcher before draining daemon shutdown tasks", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/shutdown-shell",
            name: "Shutdown shell",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream() {
                throw new Error("Inference is not expected.");
            },
        });
        const taskDrain = new TrackedTaskDrain();
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
                cwd: "/tmp/rig-shutdown-shell",
                modelId: model.id,
                permissionMode: "full_access",
            },
            taskDrain,
        });

        await session.runShellCommand({ command: "sleep 60", commandId: "shutdown-shell" });
        taskDrain.beginClose();
        await session.beginShutdown();

        await expect(taskDrain.drain()).resolves.toBeUndefined();
        expect(
            session.events
                .since(undefined)
                ?.some((event) => event.type === "shell_command_finished"),
        ).toBe(true);
    });

    it("stops active descendants instead of suspending them", async () => {
        const pauseDescendants = vi.fn(async () => 1);
        const stopDescendants = vi.fn(async () => 1);
        const session = new InMemorySession({
            agentManager: {
                pauseDescendants,
                stopDescendants,
            } as unknown as AgentSessionManager,
            createEventId: createEventIdFactory(),
            modelCatalog: testCatalog(),
            request: {
                cwd: "/tmp/rig-parent-hard-abort-test",
                modelId: "test/parent-abort",
                providerId: "test",
            },
        });

        await expect(session.abort()).resolves.toEqual({ aborted: true });
        expect(stopDescendants).toHaveBeenCalledWith(session.id);
        expect(pauseDescendants).not.toHaveBeenCalled();
    });

    it("stops active descendants even when the parent has no active run", async () => {
        const stopDescendants = vi.fn(async () => 2);
        const session = new InMemorySession({
            agentManager: { stopDescendants } as unknown as AgentSessionManager,
            createEventId: createEventIdFactory(),
            modelCatalog: testCatalog(),
            request: {
                cwd: "/tmp/rig-parent-abort-test",
                modelId: "test/parent-abort",
                providerId: "test",
            },
        });

        await expect(session.abort()).resolves.toEqual({ aborted: true });
        expect(stopDescendants).toHaveBeenCalledWith(session.id);
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
            let processManager: NativeProcessManager | undefined;
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
            session.abort({ continuePendingSteering: true, stopDescendants: false }),
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

    it("continues from already-applied steering without storing or applying it again", async () => {
        const firstInferenceStarted = deferred<void>();
        const releaseFirstInference = deferred<void>();
        const secondInferenceStarted = deferred<void>();
        const contexts: Context[] = [];
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/applied-steering-continuation",
            name: "Applied steering continuation",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, context, options) {
                contexts.push(context);
                if (contexts.length === 1) {
                    return gatedToolCallStream(
                        model.id,
                        firstInferenceStarted.resolve,
                        releaseFirstInference.promise,
                    );
                }
                if (contexts.length === 2) {
                    return abortableStream(options?.signal, secondInferenceStarted.resolve);
                }
                return responseStream("Continued from applied steering.");
            },
        });
        const session = createSession(provider, model, "/tmp/rig-applied-steering");
        const submitted = session.submit({ text: "Start the applied steering run." });
        await firstInferenceStarted.promise;
        session.steer({
            clientSubmissionId: "already-applied",
            expectedRunId: submitted.runId,
            text: "Use this exactly once.",
        });
        releaseFirstInference.resolve();
        await secondInferenceStarted.promise;
        expect(
            session.events
                .since(undefined)
                ?.filter(
                    (event) =>
                        event.type === "steering_applied" &&
                        event.data.messageIds.includes("already-applied"),
                ),
        ).toHaveLength(1);

        await expect(
            session.abort({
                continuePendingSteering: true,
                expectedRunId: submitted.runId,
                stopDescendants: false,
                steeringMessageIds: ["already-applied"],
            }),
        ).resolves.toMatchObject({ aborted: true, continued: true });
        await expect(session.waitForRun(submitted.runId)).resolves.toEqual({
            status: "completed",
        });

        expect(contexts).toHaveLength(3);
        expect(
            userTexts(contexts[2]).filter((text) => text === "Use this exactly once."),
        ).toHaveLength(1);
        const events = session.events.since(undefined) ?? [];
        expect(events.filter((event) => event.type === "abort_requested")).toHaveLength(1);
        expect(
            events.filter(
                (event) =>
                    event.type === "message_submitted" &&
                    event.data.message.id === "already-applied",
            ),
        ).toHaveLength(1);
        expect(
            events.flatMap((event) =>
                event.type === "steering_applied"
                    ? event.data.messageIds.filter((id) => id === "already-applied")
                    : [],
            ),
        ).toHaveLength(1);
    });

    it("continues mixed applied and pending steering in FIFO order exactly once", async () => {
        const firstInferenceStarted = deferred<void>();
        const releaseFirstInference = deferred<void>();
        const secondInferenceStarted = deferred<void>();
        const contexts: Context[] = [];
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/mixed-steering-continuation",
            name: "Mixed steering continuation",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, context, options) {
                contexts.push(context);
                if (contexts.length === 1) {
                    return gatedToolCallStream(
                        model.id,
                        firstInferenceStarted.resolve,
                        releaseFirstInference.promise,
                    );
                }
                if (contexts.length === 2) {
                    return abortableStream(options?.signal, secondInferenceStarted.resolve);
                }
                return responseStream("Continued mixed steering.");
            },
        });
        const session = createSession(provider, model, "/tmp/rig-mixed-steering");
        const submitted = session.submit({ text: "Start the mixed steering run." });
        await firstInferenceStarted.promise;
        session.steer({ clientSubmissionId: "applied-first", text: "Applied first." });
        releaseFirstInference.resolve();
        await secondInferenceStarted.promise;
        session.steer({ clientSubmissionId: "pending-second", text: "Pending second." });

        await expect(
            session.abort({
                continuePendingSteering: true,
                expectedRunId: submitted.runId,
                stopDescendants: false,
                steeringMessageIds: ["applied-first", "pending-second"],
            }),
        ).resolves.toMatchObject({ aborted: true, continued: true });
        await expect(session.waitForRun(submitted.runId)).resolves.toEqual({
            status: "completed",
        });

        const continuedTexts = userTexts(contexts[2]);
        expect(continuedTexts.filter((text) => text === "Applied first.")).toHaveLength(1);
        expect(continuedTexts.filter((text) => text === "Pending second.")).toHaveLength(1);
        expect(continuedTexts.indexOf("Applied first.")).toBeLessThan(
            continuedTexts.indexOf("Pending second."),
        );
        const appliedIds = session.events
            .since(undefined)
            ?.flatMap((event) => (event.type === "steering_applied" ? event.data.messageIds : []));
        expect(appliedIds).toEqual(["applied-first", "pending-second"]);
    });

    it("coalesces matching interrupts and rejects conflicting abort semantics", async () => {
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
        const stopDescendants = vi.fn(() => releaseDescendants.promise);
        session = new InMemorySession({
            agentManager: { stopDescendants } as unknown as AgentSessionManager,
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
        expect(stopDescendants).toHaveBeenCalledOnce();
        await expect(
            session.abort({ continuePendingSteering: true, stopDescendants: false }),
        ).rejects.toThrow("An abort request with different options is already in progress.");
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
        expect(events.filter((event) => event.type === "subagents_suspended")).toHaveLength(0);
        expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
        const appliedIds = events.flatMap((event) =>
            event.type === "steering_applied" ? event.data.messageIds : [],
        );
        expect(new Set(appliedIds).size).toBe(2);
        expect(appliedIds).toHaveLength(2);
    });

    it("lets a hard abort override an in-flight steering continuation", async () => {
        const started = deferred<void>();
        const releaseDescendants = deferred<number>();
        const contexts: Context[] = [];
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/hard-abort-override",
            name: "Hard abort override",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, context, options) {
                contexts.push(context);
                return abortableStream(options?.signal, started.resolve);
            },
        });
        const stopDescendants = vi.fn(() => releaseDescendants.promise);
        const session = new InMemorySession({
            agentManager: { stopDescendants } as unknown as AgentSessionManager,
            createEventId: createEventIdFactory(),
            createRuntime: (options) => createRuntime(options, provider),
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: provider.id,
                models: [model],
                providers: [{ models: [model], providerId: provider.id }],
            },
            request: { cwd: "/tmp/rig-hard-abort-override", modelId: model.id },
        });

        const submitted = session.submit({ text: "Start waiting." });
        await started.promise;
        session.steer({ text: "Do not revive this run after a hard abort." });

        const continuingAbort = session.abort({
            continuePendingSteering: true,
            expectedRunId: submitted.runId,
        });
        const hardAbort = session.abort({ expectedRunId: submitted.runId });
        releaseDescendants.resolve(1);

        await expect(Promise.all([continuingAbort, hardAbort])).resolves.toEqual([
            expect.objectContaining({ aborted: true }),
            expect.objectContaining({ aborted: true }),
        ]);
        expect(await continuingAbort).not.toHaveProperty("continued");
        expect(await hardAbort).not.toHaveProperty("continued");
        await expect(session.waitForRun(submitted.runId)).resolves.toEqual({ status: "aborted" });

        expect(contexts).toHaveLength(1);
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "abort_requested"),
        ).toHaveLength(1);
        expect(stopDescendants).toHaveBeenCalledOnce();
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
        await expect(
            session.abort({
                continuePendingSteering: true,
                expectedRunId: replacement.runId,
                steeringMessageIds: ["steering-from-the-finished-run"],
            }),
        ).resolves.toEqual({ aborted: false });
        expect(session.summary()).toMatchObject({ status: "running" });

        await expect(session.abort({ expectedRunId: replacement.runId })).resolves.toMatchObject({
            aborted: true,
        });
    });

    it("does not continue from notification steering IDs", async () => {
        const started = deferred<void>();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/notification-continuation",
            name: "Notification continuation",
            thinkingLevels: ["off"],
        });
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, _context, options) {
                return abortableStream(options?.signal, started.resolve);
            },
        });
        const session = createSession(provider, model, "/tmp/rig-notification-continuation");
        const submitted = session.submit({ text: "Keep running." });
        await started.promise;
        const notification = session.deliverNotification({ text: "Background work completed." });
        const notificationEvent = session.events
            .since(undefined)
            ?.find((event) => event.id === notification.eventId);
        expect(notificationEvent?.type).toBe("message_submitted");
        const notificationMessageId =
            notificationEvent?.type === "message_submitted"
                ? notificationEvent.data.message.id
                : "missing";

        await expect(
            session.abort({
                continuePendingSteering: true,
                expectedRunId: submitted.runId,
                steeringMessageIds: [notificationMessageId],
            }),
        ).resolves.toEqual({ aborted: false });
        expect(session.summary()).toMatchObject({ status: "running" });
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "abort_requested"),
        ).toHaveLength(0);

        await expect(session.abort({ expectedRunId: submitted.runId })).resolves.toMatchObject({
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
    const processManager = new NativeProcessManager();
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
        executor: provider,
    };
}

function createSession(
    provider: ReturnType<typeof defineProvider>,
    model: ReturnType<typeof defineModel>,
    cwd: string,
): InMemorySession {
    return new InMemorySession({
        createEventId: createEventIdFactory(),
        createRuntime: (options) => createRuntime(options, provider),
        modelCatalog: {
            defaultModelId: model.id,
            defaultProviderId: provider.id,
            models: [model],
            providers: [{ models: [model], providerId: provider.id }],
        },
        request: { cwd, modelId: model.id },
    });
}

function userTexts(context: Context | undefined): string[] {
    return (
        context?.messages.flatMap((message) =>
            message.role === "user" && Array.isArray(message.content)
                ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
                : [],
        ) ?? []
    );
}

function gatedToolCallStream(
    model: string,
    onStart: () => void,
    release: Promise<void>,
): InferenceStream {
    const message: AssistantMessage = {
        ...assistantMessage("", model),
        content: [
            {
                arguments: {},
                id: "unknown-boundary-tool",
                name: "unknown-boundary-tool",
                type: "toolCall",
            },
        ],
        stopReason: "toolUse",
    };
    return {
        async *[Symbol.asyncIterator]() {
            onStart();
            await release;
            yield { partial: message, type: "start" as const };
            yield { message, reason: "toolUse" as const, type: "done" as const };
        },
        async result() {
            await release;
            return message;
        },
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
        // eslint-disable-next-line require-yield -- This fixture fails after abort without emitting content.
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
