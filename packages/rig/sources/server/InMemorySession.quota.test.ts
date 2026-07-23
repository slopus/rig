import { describe, expect, it, vi } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CodingAssistantRuntime } from "../runtime/CodingAssistantRuntime.js";
import type { CreateCodingAssistantAgentOptions } from "../runtime/createCodingAssistantAgent.js";
import { NativeProcessManager } from "../processes/index.js";
import { createEventIdFactory, type ModelCatalog } from "../protocol/index.js";
import type { ProviderQuota } from "@slopus/rig-providers";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type InferenceStream,
} from "@slopus/rig-execution";
import { InMemorySession } from "./InMemorySession.js";

describe("InMemorySession quota observations", () => {
    it("persists fresh before/after checkpoints around a primary provider run", async () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/quota-test",
            name: "Quota test",
            thinkingLevels: ["off"],
        });
        const quota = vi
            .fn<(options?: { fresh?: boolean }) => Promise<ProviderQuota>>()
            .mockResolvedValueOnce(snapshot(20, 10))
            .mockResolvedValueOnce(snapshot(23, 11));
        const provider = defineProvider({
            id: "codex",
            models: [model],
            quota,
            stream: () => responseStream(model.id),
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
            request: {
                cwd: "/tmp/rig-quota-observation",
                modelId: model.id,
                providerId: provider.id,
            },
        });

        const submitted = session.submit({ text: "Observe this run." });
        await expect(session.waitForRun(submitted.runId)).resolves.toEqual({ status: "completed" });
        await vi.waitFor(() => expect(quota).toHaveBeenCalledTimes(2));

        const observations = session.events
            .since(undefined)
            ?.filter((event) => event.type === "provider_quota_observed");
        expect(observations).toHaveLength(2);
        expect(observations?.map((event) => event.data.phase)).toEqual(["before", "after"]);
        expect(observations?.[0]?.data.observationId).toBe(observations?.[1]?.data.observationId);
        expect(quota).toHaveBeenNthCalledWith(1, { fresh: true });
        expect(quota).toHaveBeenNthCalledWith(2, { fresh: true });
        expect(session.usage().observedQuota).toEqual([
            {
                providerId: "codex",
                windows: {
                    fiveHour: { observedUsedPercent: 3 },
                    weekly: { observedUsedPercent: 1 },
                },
            },
        ]);
    });
});

function snapshot(fiveHourUsed: number, weeklyUsed: number): ProviderQuota {
    return {
        capturedAt: 1,
        source: "codex",
        windows: {
            fiveHour: {
                capturedAt: 1,
                durationMs: 18_000_000,
                resetsAt: 100,
                status: "available",
                usedPercent: fiveHourUsed,
            },
            weekly: {
                capturedAt: 1,
                durationMs: 604_800_000,
                resetsAt: 200,
                status: "available",
                usedPercent: weeklyUsed,
            },
        },
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

function responseStream(model: string): InferenceStream {
    const message: AssistantMessage = {
        api: "test",
        content: [{ text: "Observed.", type: "text" }],
        model,
        provider: "codex",
        role: "assistant",
        stopReason: "stop",
        timestamp: 1,
        usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 10,
            output: 2,
            totalTokens: 12,
        },
    };
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
