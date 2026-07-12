import { describe, expect, it } from "vitest";

import type { ModelCatalog } from "../protocol/index.js";
import { defineModel } from "../providers/types.js";
import { InMemorySessionStore } from "./InMemorySessionStore.js";

describe("InMemorySession", () => {
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

    it("routes the same canonical model through the explicitly selected provider", () => {
        const sharedModel = defineModel({
            defaultThinkingLevel: "medium",
            id: "openai/shared",
            name: "Shared model",
            thinkingLevels: ["medium"],
        });
        const bedrockOnlyModel = defineModel({
            defaultThinkingLevel: "off",
            id: "zai/bedrock-only",
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
            modelId: "zai/glm-5",
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
