import { describe, expect, it, vi } from "vitest";

import type { ModelCatalog } from "../protocol/index.js";
import { defineModel } from "@slopus/rig-execution";
import { InMemorySessionStore } from "./InMemorySessionStore.js";

describe("InMemorySession", () => {
    it("rejects an unsupported queued effort before changing session state", () => {
        const model = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/queued-effort",
            name: "Queued effort model",
            thinkingLevels: ["off", "low"],
        });
        const session = new InMemorySessionStore({
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: "codex",
                models: [model],
                providers: [{ providerId: "codex", models: [model] }],
            },
        }).create({ cwd: "/tmp/rig-session-test" });

        expect(() => session.submit({ effort: "high", text: "Do not queue this." })).toThrow(
            "Model 'openai/queued-effort' does not support 'high' reasoning.",
        );
        expect(session.state().messages).toEqual([]);
        expect(session.state().queuedRuns).toEqual([]);
    });

    it("treats repeated client submission IDs as one durable message", () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-session-test" });

        const first = session.submit({ clientSubmissionId: "mobile-message-1", text: "Continue." });
        const repeated = session.submit({
            clientSubmissionId: "mobile-message-1",
            text: "Continue.",
        });

        expect(repeated).toEqual(first);
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "message_submitted"),
        ).toHaveLength(1);
        session.abort();
    });

    it("persists direct shell results as pending model history without starting a run", async () => {
        const session = new InMemorySessionStore().create({
            cwd: "/tmp/rig-session-test",
            permissionMode: "full_access",
        });

        const result = await session.runShellCommand({
            command: "printf persisted-shell-output",
            commandId: "shell-command-1",
        });

        expect(result).toMatchObject({
            command: "printf persisted-shell-output",
            commandId: "shell-command-1",
        });
        await vi.waitFor(() => {
            expect(session.state().messages.at(-1)).toMatchObject({
                isPartial: false,
                message: {
                    blocks: [
                        {
                            text: expect.stringContaining("<user_shell_command>"),
                            type: "text",
                        },
                    ],
                    role: "user",
                },
                runId: "shell:shell-command-1",
            });
        });
        expect(session.snapshot().snapshot.queue.at(-1)?.message).toMatchObject({
            blocks: [{ text: expect.stringContaining("persisted-shell-output"), type: "text" }],
            role: "user",
        });
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "run_started"),
        ).toHaveLength(0);
    });

    it("rejects steering when no run is active", () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-session-test" });

        expect(() => session.steer({ text: "Change direction." })).toThrow(
            "There is no active run to steer.",
        );
    });

    it("wakes an idle session for a notification", () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-session-test" });

        const delivered = session.deliverNotification({
            displayText: "Background work finished.",
            text: "<subagent-notification>Done</subagent-notification>",
        });

        expect(session.summary().status).toBe("running");
        expect(session.snapshot().snapshot).toMatchObject({
            messages: [
                {
                    blocks: [
                        {
                            text: "Background work finished.",
                            type: "text",
                        },
                    ],
                    role: "user",
                },
            ],
        });
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "run_started"),
        ).toHaveLength(1);
        expect(
            session.events.since(undefined)?.find((event) => event.type === "message_submitted"),
        ).toMatchObject({ data: { source: "notification" } });
        expect(delivered.runId).toBe(
            session.events.since(undefined)?.find((event) => event.type === "run_started")?.data
                .runId,
        );
        session.abort();
    });

    it("queues later notifications as steering on the run woken by the first", () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-session-test" });

        const first = session.deliverNotification({
            displayText: "First background agent finished.",
            text: "<subagent-notification>First</subagent-notification>",
        });
        const second = session.deliverNotification({
            displayText: "Second background agent finished.",
            text: "<subagent-notification>Second</subagent-notification>",
        });

        expect(second.runId).toBe(first.runId);
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "run_started"),
        ).toHaveLength(1);
        const snapshot = session.snapshot().snapshot;
        expect(snapshot.messages).toEqual([
            expect.objectContaining({
                blocks: [{ text: "First background agent finished.", type: "text" }],
            }),
            expect.objectContaining({
                blocks: [{ text: "Second background agent finished.", type: "text" }],
            }),
        ]);
        expect(snapshot.queue).toEqual([
            expect.objectContaining({
                message: expect.objectContaining({
                    blocks: [
                        {
                            text: "<subagent-notification>Second</subagent-notification>",
                            type: "text",
                        },
                    ],
                }),
            }),
        ]);
        session.abort();
    });

    it("preserves the user-facing stop reason when workflow cancellation rejects", async () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-session-test" });
        const run = session.launchWorkflow({
            code: "42",
            description: "Wait for cancellation",
            execute: ({ signal }) =>
                new Promise<never>((_resolve, reject) => {
                    signal.addEventListener(
                        "abort",
                        () => reject(new Error("Internal cancellation detail.")),
                        { once: true },
                    );
                }),
            name: "cancellation-check",
        });

        expect(session.stopWorkflow(run.runId)).toMatchObject({
            error: "The workflow was stopped.",
            status: "stopped",
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(session.getWorkflow(run.runId)).toMatchObject({
            error: "The workflow was stopped.",
            status: "stopped",
        });
        session.abort();
    });

    it("publishes live workflow phase, progress, and completion state", async () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-session-test" });
        const run = session.launchWorkflow({
            code: "42",
            description: "Inspect the workflow state",
            execute: async ({ onAgentCall, onLog }) => {
                onLog("Phase: Inspect");
                onAgentCall();
                onLog("Checked the target.");
                return { agentCalls: [], output: { checked: true } };
            },
            name: "state-check",
        });

        await new Promise((resolve) => setImmediate(resolve));

        expect(session.snapshot().workflows).toEqual([
            expect.objectContaining({
                agentCount: 1,
                description: "Inspect the workflow state",
                logs: ["Phase: Inspect", "Checked the target."],
                output: { checked: true },
                phase: "Inspect",
                runId: run.runId,
                status: "completed",
            }),
        ]);
        expect(
            session.events.since(undefined)?.filter((event) => event.type === "workflow_changed"),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    data: { update: expect.objectContaining({ status: "running" }) },
                }),
                expect.objectContaining({
                    data: {
                        update: expect.objectContaining({
                            output: { checked: true },
                            status: "completed",
                        }),
                    },
                }),
            ]),
        );
        session.abort();
    });

    it("resumes unchanged workflow code from its latest Monty checkpoint", async () => {
        const session = new InMemorySessionStore().create({ cwd: "/tmp/rig-session-test" });
        const checkpoint = {
            nextAgentCallIndex: 1,
            phase: "Verify",
            snapshot: new Uint8Array([1, 2, 3]),
        };
        const cachedAgent = { output: "cached", signature: "cached-signature" };
        const interrupted = session.launchWorkflow({
            code: 'agent("check")',
            description: "Checkpoint a workflow",
            execute: async ({ onAgentResult, onCheckpoint }) => {
                onAgentResult(0, cachedAgent);
                onCheckpoint(checkpoint);
                throw new Error("Simulated workflow interruption.");
            },
            name: "checkpointed-workflow",
        });
        await new Promise((resolve) => setImmediate(resolve));

        let receivedResumeCheckpoint: unknown;
        let receivedResumeAgentCalls: readonly unknown[] = [];
        session.launchWorkflow({
            code: 'agent("check")',
            description: "Resume a workflow",
            execute: async (options) => {
                receivedResumeCheckpoint = options.resumeCheckpoint;
                receivedResumeAgentCalls = options.resumeAgentCalls;
                return { agentCalls: options.resumeAgentCalls, output: "resumed" };
            },
            name: "checkpointed-workflow",
            resumeFromRunId: interrupted.runId,
        });
        await new Promise((resolve) => setImmediate(resolve));

        expect(receivedResumeCheckpoint).toEqual(checkpoint);
        expect(receivedResumeAgentCalls).toEqual([cachedAgent]);
        session.abort();
    });

    it("routes the same canonical model through the explicitly selected provider", () => {
        const sharedModel = defineModel({
            defaultThinkingLevel: "medium",
            id: "openai/shared",
            name: "Shared model",
            thinkingLevels: ["medium"],
        });
        const bedrockOnlyModel = defineModel({
            defaultThinkingLevel: "off",
            id: "anthropic/bedrock-only",
            name: "Bedrock-only model",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: sharedModel.id,
            defaultProviderId: "codex",
            models: [sharedModel, bedrockOnlyModel],
            providers: [
                { providerId: "codex", models: [sharedModel] },
                { providerId: "bedrock", models: [sharedModel, bedrockOnlyModel] },
            ],
        };
        const store = new InMemorySessionStore({ modelCatalog: catalog });

        const session = store.create({
            cwd: "/tmp/rig-session-test",
            modelId: sharedModel.id,
            providerId: "bedrock",
        });

        expect(session.snapshot()).toMatchObject({
            modelId: sharedModel.id,
            models: [sharedModel, bedrockOnlyModel],
            providerId: "bedrock",
        });

        session.changeModel({ modelId: sharedModel.id, providerId: "codex" });

        expect(session.snapshot()).toMatchObject({
            modelId: sharedModel.id,
            models: [sharedModel],
            providerId: "codex",
        });
        const latestEvent = session.events.since(undefined)?.at(-1);
        expect(latestEvent).toBeDefined();
        if (latestEvent === undefined) {
            throw new Error("Expected a model change event.");
        }
        expect(latestEvent).toMatchObject({
            data: {
                modelId: sharedModel.id,
                snapshot: { providerId: "codex" },
            },
            type: "model_changed",
        });

        const inferredSession = store.create({
            cwd: "/tmp/rig-session-test",
            modelId: bedrockOnlyModel.id,
        });
        expect(inferredSession.snapshot()).toMatchObject({
            modelId: bedrockOnlyModel.id,
            providerId: "bedrock",
        });
    });

    it("keeps fast inference across Codex model changes and rejects unsupported providers", () => {
        const firstCodexModel = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/first",
            name: "First Codex model",
            thinkingLevels: ["off"],
        });
        const secondCodexModel = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/second",
            name: "Second Codex model",
            thinkingLevels: ["off"],
        });
        const claudeModel = defineModel({
            defaultThinkingLevel: "off",
            id: "anthropic/test",
            name: "Claude model",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: firstCodexModel.id,
            defaultProviderId: "codex",
            models: [firstCodexModel, secondCodexModel, claudeModel],
            providers: [
                {
                    providerId: "codex",
                    providerType: "codex",
                    models: [firstCodexModel, secondCodexModel],
                    serviceTiers: ["fast"],
                },
                {
                    providerId: "claude",
                    providerType: "claude",
                    models: [claudeModel],
                },
            ],
        };
        const store = new InMemorySessionStore({ modelCatalog: catalog });
        const session = store.create({
            cwd: "/tmp/rig-session-test",
            modelId: firstCodexModel.id,
            providerId: "codex",
            serviceTier: "fast",
        });

        session.changeModel({ modelId: secondCodexModel.id, providerId: "codex" });

        expect(session.snapshot()).toMatchObject({
            modelId: secondCodexModel.id,
            providerId: "codex",
            serviceTier: "fast",
            snapshot: { serviceTier: "fast" },
        });
        expect(session.snapshot().snapshot.contextMessages).toBeUndefined();
        expect(session.state().serviceTier).toBe("fast");

        session.changeServiceTier({});
        expect(session.snapshot().serviceTier).toBeUndefined();
        expect(session.events.since(undefined)?.at(-1)).toMatchObject({
            data: { serviceTier: null },
            type: "service_tier_changed",
        });

        session.changeModel({ modelId: claudeModel.id, providerId: "claude" });
        expect(session.snapshot().snapshot.contextMessages).toBeUndefined();
        expect(() => session.changeServiceTier({ serviceTier: "fast" })).toThrow(
            "does not support fast inference",
        );

        const unsupportedDefault = store.create({
            cwd: "/tmp/rig-session-test",
            modelId: claudeModel.id,
            providerId: "claude",
            serviceTier: "fast",
        });
        expect(unsupportedDefault.snapshot().serviceTier).toBeUndefined();
    });

    it("falls back when the configured model is no longer available", () => {
        const availableModel = defineModel({
            defaultThinkingLevel: "medium",
            id: "openai/available",
            name: "Available model",
            thinkingLevels: ["off", "medium"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: availableModel.id,
            defaultProviderId: "codex",
            models: [availableModel],
            providers: [{ providerId: "codex", models: [availableModel] }],
        };
        const store = new InMemorySessionStore({ modelCatalog: catalog });

        const session = store.create({
            cwd: "/tmp/rig-session-test",
            effort: "max",
            modelId: "removed/model",
            providerId: "bedrock",
        });

        expect(session.snapshot()).toMatchObject({
            effort: "medium",
            modelId: availableModel.id,
            models: [availableModel],
            providerId: "codex",
        });
    });

    it("keeps the requested model when another enabled provider serves it", () => {
        const sharedModel = defineModel({
            defaultThinkingLevel: "medium",
            id: "openai/shared",
            name: "Shared model",
            thinkingLevels: ["medium"],
        });
        const fallbackModel = defineModel({
            defaultThinkingLevel: "off",
            id: "openai/fallback",
            name: "Fallback model",
            thinkingLevels: ["off"],
        });
        const catalog: ModelCatalog = {
            defaultModelId: fallbackModel.id,
            defaultProviderId: "codex",
            models: [fallbackModel, sharedModel],
            providers: [
                { providerId: "codex", models: [fallbackModel] },
                { providerId: "openai", models: [sharedModel] },
            ],
        };
        const store = new InMemorySessionStore({ modelCatalog: catalog });

        const session = store.create({
            cwd: "/tmp/rig-session-test",
            modelId: sharedModel.id,
            providerId: "bedrock",
        });

        expect(session.snapshot()).toMatchObject({
            modelId: sharedModel.id,
            models: [sharedModel],
            providerId: "openai",
        });
    });

    it("changes permissions and passes them to subagents", async () => {
        const store = new InMemorySessionStore();
        const session = store.create({
            cwd: "/tmp/rig-session-test",
            permissionMode: "read_only",
        });

        expect(session.snapshot().permissionMode).toBe("read_only");
        expect(session.requestForSubagent().permissionMode).toBe("read_only");

        await session.changePermissionMode({ permissionMode: "full_access" });

        expect(session.snapshot().permissionMode).toBe("full_access");
        expect(session.requestForSubagent().permissionMode).toBe("full_access");
        expect(session.events.since(undefined)?.at(-1)).toMatchObject({
            data: { permissionMode: "full_access" },
            type: "permission_mode_changed",
        });
    });

    it("holds a structured question until the user answers it", async () => {
        const store = new InMemorySessionStore();
        const session = store.create({ cwd: "/tmp/rig-session-test" });
        const request = {
            requestId: "question-1",
            questions: [
                {
                    header: "Database",
                    id: "database",
                    multiSelect: false,
                    options: [
                        { label: "PostgreSQL", description: "Use a server database." },
                        { label: "SQLite", description: "Use a local database." },
                    ],
                    question: "Which database should be used?",
                },
            ],
        };

        const pending = session.requestUserInput(request);

        expect(session.snapshot().pendingUserInputs).toEqual([request]);
        expect(session.events.since(undefined)?.at(-1)).toMatchObject({
            data: request,
            type: "user_input_requested",
        });

        session.answerUserInput("question-1", { answers: { database: ["PostgreSQL"] } });

        await expect(pending).resolves.toEqual({ answers: { database: ["PostgreSQL"] } });
        expect(session.snapshot().pendingUserInputs).toEqual([]);
        expect(session.events.since(undefined)?.at(-1)).toMatchObject({
            data: {
                answers: { database: ["PostgreSQL"] },
                requestId: "question-1",
                status: "answered",
            },
            type: "user_input_resolved",
        });
    });

    it("cancels a pending question when its run is aborted", async () => {
        const store = new InMemorySessionStore();
        const session = store.create({ cwd: "/tmp/rig-session-test" });
        const controller = new AbortController();
        const pending = session.requestUserInput(
            {
                requestId: "question-1",
                questions: [
                    {
                        header: "Choice",
                        id: "choice",
                        multiSelect: false,
                        options: [
                            { label: "One", description: "Choose one." },
                            { label: "Two", description: "Choose two." },
                        ],
                        question: "Which choice should be used?",
                    },
                ],
            },
            { signal: controller.signal },
        );

        controller.abort();

        await expect(pending).rejects.toThrow("cancelled");
        expect(session.snapshot().pendingUserInputs).toEqual([]);
        expect(session.events.since(undefined)?.at(-1)).toMatchObject({
            data: { requestId: "question-1", status: "cancelled" },
            type: "user_input_resolved",
        });
    });
});
