import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CreateCodingAssistantAgentOptions } from "../app/createCodingAssistantAgent.js";
import type { CodingAssistantRuntime } from "../app/CodingAssistantRuntime.js";
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

function createHarness(options: { activeSubagent?: boolean; staleMetadata?: Promise<void> } = {}) {
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
        subagentSummary: () => subagentSummary(activeSubagent),
    } as InMemorySession;
    const manager = new AgentSessionManager({
        repository: {
            createSubagent: () => child,
            get: () => root,
            listByRoot: () => (activeSubagent ? [child] : []),
        },
    });
    let backgroundCount = 0;
    let backgroundListener: ((count: number) => void) | undefined;
    root = new InMemorySession({
        agentManager: manager,
        createEventId: createEventIdFactory(),
        createRuntime: (runtimeOptions) => {
            const runtime = createRuntime(runtimeOptions, provider);
            runtime.context.bash.activeSessionCount = () => backgroundCount;
            runtime.context.bash.setActiveSessionCountListener = (listener) => {
                backgroundListener = listener;
                listener?.(backgroundCount);
            };
            return runtime;
        },
        modelCatalog: catalog,
        request: { cwd: "/tmp/rig-metadata-test", modelId: model.id, providerId: provider.id },
    });
    return {
        metadataContexts,
        metadataSignals,
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
