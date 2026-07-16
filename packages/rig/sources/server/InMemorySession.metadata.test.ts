import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CodingAssistantRuntime } from "../runtime/CodingAssistantRuntime.js";
import type { CreateCodingAssistantAgentOptions } from "../runtime/createCodingAssistantAgent.js";
import { NativeProxessManager } from "../processes/index.js";
import {
    createEventIdFactory,
    type ModelCatalog,
    type SubagentSummary,
} from "../protocol/index.js";
import { createInferenceStream } from "../providers/createInferenceStream.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
    type StreamOptions,
} from "../providers/types.js";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { InMemorySession } from "./InMemorySession.js";
import { TrackedTaskDrain } from "./TrackedTaskDrain.js";

afterEach(() => {
    vi.useRealTimers();
});

describe("InMemorySession metadata settlement", () => {
    it("waits for sixty idle seconds and restarts on new user work", async () => {
        vi.useFakeTimers();
        const harness = createHarness();

        const first = harness.session.submit({ text: "Implement delayed session metadata." });
        await harness.session.waitForRun(first.runId);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(harness.metadataContexts).toHaveLength(0);

        const second = harness.session.submit({
            text: "Also keep the existing title conservatively.",
        });
        await harness.session.waitForRun(second.runId);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(harness.metadataContexts).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);

        expect(harness.metadataContexts).toHaveLength(1);
        expect(JSON.stringify(harness.metadataContexts[0])).toContain(
            "Implement delayed session metadata.",
        );
        expect(JSON.stringify(harness.metadataContexts[0])).toContain("Final visible response 2.");
        expect(harness.session.snapshot()).toMatchObject({
            metadataRunId: second.runId,
            recap: "The user implemented delayed session metadata.",
            title: "Delayed session metadata",
            titleStatus: "ready",
        });
    });

    it("restarts the idle window for unsent user activity", async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        const run = harness.session.submit({ text: "Wait for an unsent draft." });
        await harness.session.waitForRun(run.runId);

        await vi.advanceTimersByTimeAsync(59_999);
        harness.session.recordUserActivity();
        await vi.advanceTimersByTimeAsync(59_999);
        expect(harness.metadataContexts).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(harness.metadataContexts).toHaveLength(1);
    });

    it("discards an aborted stale generation when new work arrives", async () => {
        vi.useFakeTimers();
        let releaseStale: (() => void) | undefined;
        const staleReleased = new Promise<void>((resolve) => {
            releaseStale = resolve;
        });
        const harness = createHarness({ staleMetadata: staleReleased });

        const first = harness.session.submit({ text: "Initial request." });
        await harness.session.waitForRun(first.runId);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataSignals[0]?.aborted).toBe(false);

        const second = harness.session.submit({ text: "A newer request supersedes it." });
        expect(harness.metadataSignals[0]?.aborted).toBe(true);
        releaseStale?.();
        await harness.session.waitForRun(second.runId);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(harness.session.snapshot()).toMatchObject({
            metadataRunId: second.runId,
            title: "Delayed session metadata",
        });
        expect(harness.session.snapshot().title).not.toBe("Stale generated title");
    });

    it("settles metadata for the run_error boundary repaired after interruption", async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        const foreground = harness.session.submit({ text: "Finish before the restart." });
        await harness.session.waitForRun(foreground.runId);
        await vi.advanceTimersByTimeAsync(60_000);

        harness.session.markInterrupted({
            interruptedAt: Date.now(),
            message: "The restored run was interrupted.",
            reason: "crash",
            runId: "restored-run",
        });
        await vi.advanceTimersByTimeAsync(59_999);
        expect(harness.metadataContexts).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(harness.metadataContexts).toHaveLength(2);
        expect(harness.session.snapshot().metadataRunId).toBe("restored-run");
    });

    it("invalidates stale metadata on rewind and reset", async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        const first = harness.session.submit({ text: "Keep this turn." });
        await harness.session.waitForRun(first.runId);
        const second = harness.session.submit({ text: "Remove this turn." });
        await harness.session.waitForRun(second.runId);
        await vi.advanceTimersByTimeAsync(60_000);

        const secondMessage = harness.session
            .snapshot()
            .snapshot.messages.find(
                (message) =>
                    message.role === "user" &&
                    message.blocks[0]?.type === "text" &&
                    message.blocks[0].text === "Remove this turn.",
            );
        if (secondMessage === undefined) throw new Error("Second user message was not persisted.");
        harness.session.rewind(secondMessage.id);
        expect(harness.session.snapshot()).toMatchObject({ titleStatus: "idle" });
        expect(harness.session.snapshot()).not.toHaveProperty("metadataRunId");
        expect(harness.session.snapshot()).not.toHaveProperty("metadataUpdatedAt");
        expect(harness.session.snapshot()).not.toHaveProperty("recap");

        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.session.snapshot().metadataRunId).toBe(first.runId);

        await harness.session.reset();
        expect(harness.session.snapshot()).toMatchObject({ titleStatus: "idle" });
        expect(harness.session.snapshot()).not.toHaveProperty("metadataRunId");
        expect(harness.session.snapshot()).not.toHaveProperty("metadataUpdatedAt");
        expect(harness.session.snapshot()).not.toHaveProperty("recap");
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataContexts).toHaveLength(2);
    });

    it("restarts the root idle window for descendant-local activity transitions", async () => {
        vi.useFakeTimers();
        const harness = createHarness();
        const foreground = harness.session.submit({ text: "Wait for descendant work." });
        await harness.session.waitForRun(foreground.runId);

        await vi.advanceTimersByTimeAsync(59_999);
        harness.setSubagentActive(true);
        harness.recordDescendantActivity();
        await vi.advanceTimersByTimeAsync(10_000);
        harness.setSubagentActive(false);
        harness.recordDescendantActivity();
        await vi.advanceTimersByTimeAsync(59_999);
        expect(harness.metadataContexts).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(harness.metadataContexts).toHaveLength(1);
    });

    it("blocks settlement while manual compaction is active", async () => {
        vi.useFakeTimers();
        let finishCompaction: (() => void) | undefined;
        const compaction = new Promise<void>((resolve) => {
            finishCompaction = resolve;
        });
        const harness = createHarness({ compaction });
        const foreground = harness.session.submit({ text: "Compact before settling." });
        await harness.session.waitForRun(foreground.runId);

        await vi.advanceTimersByTimeAsync(59_999);
        const compacting = harness.session.compact();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataContexts).toHaveLength(0);

        finishCompaction?.();
        await compacting;
        await vi.advanceTimersByTimeAsync(59_999);
        expect(harness.metadataContexts).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(harness.metadataContexts).toHaveLength(1);
    });

    it("tracks the delayed settlement until shutdown cancels it", async () => {
        vi.useFakeTimers();
        const taskDrain = new TrackedTaskDrain();
        const harness = createHarness({ taskDrain });
        const foreground = harness.session.submit({ text: "Cancel delayed metadata on shutdown." });
        await harness.session.waitForRun(foreground.runId);
        await vi.advanceTimersByTimeAsync(0);

        let drained = false;
        const draining = taskDrain.drain().then(() => {
            drained = true;
        });
        await Promise.resolve();
        expect(drained).toBe(false);

        await harness.session.beginShutdown();
        await draining;
        expect(harness.metadataContexts).toHaveLength(0);
    });

    it("awaits an aborted metadata generation continuation during shutdown", async () => {
        vi.useFakeTimers();
        const taskDrain = new TrackedTaskDrain();
        let releaseAfterAbort: (() => void) | undefined;
        const afterAbort = new Promise<void>((resolve) => {
            releaseAfterAbort = resolve;
        });
        let observedAbort = false;
        const harness = createHarness({
            afterMetadataAbort: afterAbort,
            onMetadataAbort: () => {
                observedAbort = true;
            },
            taskDrain,
        });
        const foreground = harness.session.submit({ text: "Abort in-flight metadata safely." });
        await harness.session.waitForRun(foreground.runId);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataContexts).toHaveLength(1);

        taskDrain.beginClose();
        const shuttingDown = harness.session.beginShutdown();
        const draining = taskDrain.drain();
        await vi.waitFor(() => expect(observedAbort).toBe(true));
        let drained = false;
        void draining.then(() => {
            drained = true;
        });
        await Promise.resolve();
        expect(drained).toBe(false);

        releaseAfterAbort?.();
        await shuttingDown;
        await draining;
        expect(harness.session.snapshot().titleStatus).toBe("idle");
    });

    it("requires subagents, workflows, and managed background terminals to become idle", async () => {
        vi.useFakeTimers();
        const harness = createHarness({ activeSubagent: true });
        const foreground = harness.session.submit({ text: "Wait for all background work." });
        await harness.session.waitForRun(foreground.runId);

        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataContexts).toHaveLength(0);
        harness.setSubagentActive(false);
        harness.session.recordSubagentChanged(harness.subagentSummary());

        harness.setBackgroundCount(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataContexts).toHaveLength(0);
        harness.setBackgroundCount(0);

        let finishWorkflow: ((value: { agentCalls: []; output: string }) => void) | undefined;
        const workflow = harness.session.launchWorkflow({
            code: "wait()",
            description: "Wait for test completion",
            execute: () =>
                new Promise((resolve) => {
                    finishWorkflow = resolve;
                }),
            name: "metadata-wait",
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataContexts).toHaveLength(0);

        finishWorkflow?.({ agentCalls: [], output: "done" });
        await harness.session.waitForWorkflow(workflow.runId);
        await vi.advanceTimersByTimeAsync(0);
        const notification = harness.session.events
            .since(undefined)
            ?.findLast(
                (event) =>
                    event.type === "message_submitted" && event.data.source === "notification",
            );
        if (notification?.type !== "message_submitted") {
            throw new Error("Workflow completion notification did not start a foreground run.");
        }
        await harness.session.waitForRun(notification.data.runId);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(harness.metadataContexts).toHaveLength(1);
    });
});

function createHarness(
    options: {
        activeSubagent?: boolean;
        afterMetadataAbort?: Promise<void>;
        compaction?: Promise<void>;
        onMetadataAbort?: () => void;
        staleMetadata?: Promise<void>;
        taskDrain?: TrackedTaskDrain;
    } = {},
) {
    const model = defineModel({
        defaultThinkingLevel: "off",
        id: "test/session-metadata",
        name: "Session metadata",
        thinkingLevels: ["off"],
    });
    const metadataContexts: Context[] = [];
    const metadataSignals: AbortSignal[] = [];
    let agentResponses = 0;
    let metadataResponses = 0;
    const provider = defineProvider({
        id: "test",
        models: [model],
        stream(_model, context, streamOptions: StreamOptions = {}) {
            if (streamOptions.sessionId?.endsWith(":title")) {
                metadataContexts.push(context);
                if (streamOptions.signal !== undefined) metadataSignals.push(streamOptions.signal);
                metadataResponses += 1;
                return createInferenceStream(async function* () {
                    if (options.afterMetadataAbort !== undefined) {
                        await new Promise<void>((resolve) => {
                            const signal = streamOptions.signal;
                            if (signal?.aborted === true) {
                                resolve();
                                return;
                            }
                            signal?.addEventListener("abort", () => resolve(), { once: true });
                        });
                        options.onMetadataAbort?.();
                        await options.afterMetadataAbort;
                        throw new Error("Metadata generation was cancelled.");
                    }
                    if (metadataResponses === 1 && options.staleMetadata !== undefined) {
                        await options.staleMetadata;
                    }
                    const message = assistantMessage(
                        JSON.stringify(
                            metadataResponses === 1 && options.staleMetadata !== undefined
                                ? {
                                      title: "Stale generated title",
                                      recap: "This stale result must be discarded.",
                                  }
                                : {
                                      title: "Delayed session metadata",
                                      recap: "The user implemented delayed session metadata.",
                                  },
                        ),
                    );
                    yield { type: "start", partial: message };
                    yield { type: "done", reason: "stop", message };
                    return message;
                });
            }
            agentResponses += 1;
            const message = assistantMessage(`Final visible response ${agentResponses}.`);
            return createInferenceStream(async function* () {
                yield { type: "start", partial: message };
                yield { type: "done", reason: "stop", message };
                return message;
            });
        },
    });
    const catalog: ModelCatalog = {
        defaultModelId: model.id,
        defaultProviderId: provider.id,
        models: [model],
        providers: [{ providerId: provider.id, models: [model] }],
    };
    let activeSubagent = options.activeSubagent === true;
    let root: InMemorySession | undefined;
    const child = {
        agentMetadata: () => ({ depth: 1, rootSessionId: "root", type: "subagent" }),
        hasLocalSettlementWork: () => activeSubagent,
        id: "child-session",
        subagentSummary: () => subagentSummary(activeSubagent),
    } as InMemorySession;
    const manager = new AgentSessionManager({
        repository: {
            createSubagent: () => child,
            get: (sessionId) => (sessionId === child.id ? child : root),
            listByRoot: () => [child],
        },
        ...(options.taskDrain === undefined ? {} : { taskDrain: options.taskDrain }),
    });
    let backgroundCount = 0;
    let backgroundListener: ((count: number) => void) | undefined;
    root = new InMemorySession({
        agentManager: manager,
        createEventId: createEventIdFactory(),
        createRuntime: (runtimeOptions) => {
            const runtime = createRuntime(runtimeOptions, provider);
            if (options.compaction !== undefined) {
                runtime.agent.compact = async () => {
                    await options.compaction;
                    return {
                        compacted: true,
                        compactedMessageCount: 2,
                        estimatedTokensAfter: 1,
                        estimatedTokensBefore: 2,
                        retainedMessageCount: 0,
                    };
                };
            }
            runtime.context.bash.activeSessionCount = () => backgroundCount;
            runtime.context.bash.setActiveSessionCountListener = (listener) => {
                backgroundListener = listener;
                listener?.(backgroundCount);
            };
            return runtime;
        },
        modelCatalog: catalog,
        request: { cwd: "/tmp/rig-metadata-test", modelId: model.id, providerId: provider.id },
        ...(options.taskDrain === undefined ? {} : { taskDrain: options.taskDrain }),
    });
    return {
        metadataContexts,
        metadataSignals,
        recordDescendantActivity() {
            manager.recordDescendantSettlementActivity("root");
        },
        session: root,
        setBackgroundCount(count: number) {
            backgroundCount = count;
            backgroundListener?.(count);
        },
        setSubagentActive(active: boolean) {
            activeSubagent = active;
        },
        subagentSummary: () => subagentSummary(activeSubagent),
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

function assistantMessage(text: string): AssistantMessage {
    return {
        api: "test",
        content: [{ text, type: "text" }],
        model: "test/session-metadata",
        provider: "test",
        role: "assistant",
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 0,
            output: 0,
            totalTokens: 0,
        },
    };
}

function subagentSummary(active: boolean): SubagentSummary {
    return {
        agentId: "child-agent",
        createdAt: 1,
        depth: 1,
        description: "Background check",
        id: "child-session",
        modelId: "test/session-metadata",
        parentSessionId: "root",
        status: active ? "running" : "completed",
        updatedAt: 1,
    };
}
