import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

import { Agent, createNodeAgentContext } from "../agent/index.js";
import type { CreateCodingAssistantAgentOptions } from "../app/createCodingAssistantAgent.js";
import type { CodingAssistantRuntime } from "../app/CodingAssistantRuntime.js";
import { NativeProxessManager } from "../processes/index.js";
import { createEventIdFactory, type ModelCatalog } from "../protocol/index.js";
import {
    defineModel,
    defineProvider,
    type AssistantMessage,
    type InferenceStream,
} from "../providers/types.js";
import { InMemorySession } from "./InMemorySession.js";

describe("InMemorySession abort", () => {
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
});

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
    const message: AssistantMessage = {
        api: "test",
        content: [{ text, type: "text" }],
        model: "test/idle-abort",
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

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}
