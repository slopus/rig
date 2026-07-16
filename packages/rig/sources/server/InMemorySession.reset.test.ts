import { describe, expect, it } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CodingAssistantRuntime } from "../runtime/CodingAssistantRuntime.js";
import type { CreateCodingAssistantAgentOptions } from "../runtime/createCodingAssistantAgent.js";
import { NativeProxessManager } from "../processes/index.js";
import { createEventIdFactory } from "../protocol/index.js";
import { defineModel, defineProvider, type InferenceStream } from "../providers/types.js";
import { InMemorySession } from "./InMemorySession.js";

describe("InMemorySession reset", () => {
    it("terminalizes active and queued work before the reset boundary", async () => {
        const started = deferred<void>();
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "test/reset-boundary",
            name: "Reset boundary",
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
            request: { cwd: "/tmp/rig-reset-boundary", modelId: model.id },
        });

        const active = session.submit({ text: "Active before reset." });
        await started.promise;
        session.steer({ text: "Pending steering before reset." });
        const queued = session.submit({ text: "Queued before reset." });

        await session.reset();

        const events = session.events.since(undefined) ?? [];
        const boundaryIndex = events.findIndex((event) => event.type === "session_reset");
        expect(boundaryIndex).toBeGreaterThan(0);
        expect(
            events.slice(boundaryIndex + 1).filter((event) => {
                const runId = (event.data as { runId?: unknown }).runId;
                return runId === active.runId || runId === queued.runId;
            }),
        ).toEqual([]);
        expect(
            events.slice(0, boundaryIndex).filter((event) => event.type === "abort_requested"),
        ).toHaveLength(1);
        expect(
            events
                .slice(0, boundaryIndex)
                .filter((event) => event.type === "run_error" && event.data.runId === queued.runId),
        ).toHaveLength(1);
        expect(
            events
                .slice(0, boundaryIndex)
                .filter(
                    (event) => event.type === "run_finished" && event.data.runId === active.runId,
                ),
        ).toHaveLength(1);
        expect(session.snapshot()).toMatchObject({
            snapshot: { messages: [], queue: [], status: "idle" },
            status: "idle",
        });
    });
});

function createRuntime(
    options: CreateCodingAssistantAgentOptions,
    provider: ReturnType<typeof defineProvider>,
): CodingAssistantRuntime {
    const processManager = new NativeProxessManager();
    const context = createNodeAgentContext({
        cwd: options.cwd,
        permissionMode: "full_access",
        processManager,
    });
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

function abortableStream(signal: AbortSignal | undefined, onStart: () => void): InferenceStream {
    return {
        async *[Symbol.asyncIterator]() {
            onStart();
            await new Promise<void>((resolve) => {
                if (signal?.aborted === true) {
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
    const promise = new Promise<T>((innerResolve) => {
        resolvePromise = innerResolve;
    });
    return { promise, resolve: (value) => resolvePromise(value as T) };
}
