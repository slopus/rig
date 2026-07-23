import { describe, expect, it, vi } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CreateCodingAssistantAgentOptions } from "../runtime/createCodingAssistantAgent.js";
import { createEventIdFactory, type ModelCatalog } from "../protocol/index.js";
import { NativeProcessManager } from "../processes/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type Context,
    type InferenceStream,
    type Usage,
} from "@slopus/rig-execution";
import { goalTools } from "../tools/goals/index.js";
import type { CodingAssistantRuntime } from "../runtime/CodingAssistantRuntime.js";
import { InMemorySession } from "./InMemorySession.js";

describe("InMemorySession goals", () => {
    it("continues an active goal invisibly until the model completes it", async () => {
        const model = defineModel({
            defaultThinkingLevel: "medium",
            id: "test/goal-model",
            name: "Goal model",
            thinkingLevels: ["medium"],
        });
        const responses = [
            assistantMessage(
                [
                    {
                        type: "toolCall",
                        id: "goal-complete",
                        name: "update_goal",
                        arguments: { status: "complete" },
                    },
                ],
                "toolUse",
            ),
            assistantMessage([{ type: "text", text: "The goal is complete." }], "stop"),
        ];
        const stream = vi.fn(() => streamFor(responses.shift() as AssistantMessage));
        const provider = defineProvider({ id: "test", models: [model], stream });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: provider.id,
            models: [model],
            providers: [{ providerId: provider.id, models: [model] }],
        };
        const session = new InMemorySession({
            createEventId: createEventIdFactory(),
            createRuntime: (options) => createTestRuntime(options, provider),
            modelCatalog: catalog,
            request: { cwd: "/tmp/rig-goal-test", modelId: model.id, providerId: provider.id },
        });

        session.setGoal({ objective: "Finish the feature" });
        const started = session.events
            .since(undefined)
            ?.find((event) => event.type === "run_started");
        if (started?.type !== "run_started") throw new Error("Goal continuation did not start.");

        await expect(session.waitForRun(started.data.runId)).resolves.toMatchObject({
            status: "completed",
        });
        expect(session.goal()).toMatchObject({
            objective: "Finish the feature",
            status: "complete",
        });
        expect(stream).toHaveBeenCalledTimes(2);
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "run_started"),
        ).toHaveLength(1);
        expect(session.snapshot().snapshot.messages).not.toContainEqual(
            expect.objectContaining({ role: "user" }),
        );
    });

    it("keeps review commands visible while sending expanded instructions to the model", async () => {
        const model = defineModel({
            defaultThinkingLevel: "medium",
            id: "test/review-model",
            name: "Review model",
            thinkingLevels: ["medium"],
        });
        const contexts: Context[] = [];
        const provider = defineProvider({
            id: "test",
            models: [model],
            stream(_model, context) {
                contexts.push(context);
                return streamFor(
                    assistantMessage([{ type: "text", text: "No findings." }], "stop"),
                );
            },
        });
        const catalog: ModelCatalog = {
            defaultModelId: model.id,
            defaultProviderId: provider.id,
            models: [model],
            providers: [{ providerId: provider.id, models: [model] }],
        };
        const session = new InMemorySession({
            createEventId: createEventIdFactory(),
            createRuntime: (options) => createTestRuntime(options, provider),
            modelCatalog: catalog,
            request: { cwd: "/tmp/rig-review-test", modelId: model.id, providerId: provider.id },
        });

        const submitted = session.submit({ text: "/review focus on concurrency" });
        await expect(session.waitForRun(submitted.runId)).resolves.toMatchObject({
            status: "completed",
        });

        expect(session.snapshot().snapshot.messages[0]).toMatchObject({
            blocks: [{ text: "/review focus on concurrency", type: "text" }],
            role: "user",
        });
        const reviewContext = contexts.find((context) =>
            JSON.stringify(context.messages).includes("Do not modify files"),
        );
        expect(reviewContext).toBeDefined();
        expect(JSON.stringify(reviewContext?.messages)).toContain(
            "focus especially on: focus on concurrency",
        );
        expect(JSON.stringify(reviewContext?.messages)).not.toContain(
            '"text":"/review focus on concurrency"',
        );
    });
});

function createTestRuntime(
    options: CreateCodingAssistantAgentOptions,
    provider: ReturnType<typeof defineProvider>,
): CodingAssistantRuntime {
    const processManager = new NativeProcessManager();
    const context = createNodeAgentContext({
        cwd: options.cwd,
        processManager,
        ...(options.goals !== undefined ? { goals: options.goals } : {}),
    });
    return {
        agent: new Agent({
            context,
            modelId: options.modelId ?? provider.models[0]?.id ?? "",
            printToConsole: false,
            provider,
            tools: goalTools,
        }),
        context,
        cwd: options.cwd,
        processManager,
        executor: provider,
    };
}

function assistantMessage(
    content: AssistantMessage["content"],
    stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
    return {
        api: "test",
        content,
        model: "test/goal-model",
        provider: "test",
        role: "assistant",
        stopReason,
        timestamp: 1,
        usage: zeroUsage(),
    };
}

function streamFor(message: AssistantMessage): InferenceStream {
    return {
        async *[Symbol.asyncIterator]() {
            yield { type: "start" as const, partial: message };
            yield {
                type: "done" as const,
                reason: message.stopReason as "stop" | "toolUse",
                message,
            };
        },
        async result() {
            return message;
        },
    };
}

function zeroUsage(): Usage {
    return {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
    };
}
