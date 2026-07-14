import { describe, expect, it, vi } from "vitest";

import { createPermissionContext } from "../permissions/index.js";
import { defineModel } from "../providers/types.js";
import type { ModelCatalog, ProtocolSession, SessionEvent } from "../protocol/index.js";
import { createJustBashToolHarness } from "../tools/testing/createJustBashToolHarness.js";
import type { ProtocolHttpClient } from "./ProtocolHttpClient.js";
import { RemoteAgent } from "./RemoteAgent.js";

describe("RemoteAgent", () => {
    it("keeps its local context synchronized with permission responses and events", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        const changedSession = { ...session, permissionMode: "full_access" as const };
        const changePermissionMode = vi.fn(async () => ({ session: changedSession }));
        const harness = createJustBashToolHarness();
        harness.context.permissions = createPermissionContext("workspace_write");
        const agent = new RemoteAgent({
            client: { changePermissionMode } as unknown as ProtocolHttpClient,
            context: harness.context,
            session,
        });

        agent.setPermissionMode("full_access");

        expect(agent.permissionMode).toBe("workspace_write");
        expect(harness.context.permissions.mode).toBe("workspace_write");
        await vi.waitFor(() => expect(changePermissionMode).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(agent.permissionMode).toBe("full_access"));
        expect(harness.context.permissions.mode).toBe("full_access");

        agent.applySessionEvent(permissionEvent(session.id, "read_only"));

        expect(agent.permissionMode).toBe("read_only");
        expect(harness.context.permissions.mode).toBe("read_only");
    });

    it("steers the active remote run through the dedicated endpoint", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const steerMessage = vi.fn(async () => ({
            eventId: "event-2" as const,
            runId: "run-1",
            sessionId: "session-1",
        }));
        const agent = new RemoteAgent({
            client: { steerMessage } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            session: { ...protocolSession(model), status: "running" },
        });

        await agent.steer("Change direction.", { displayText: "Change direction." });

        expect(steerMessage).toHaveBeenCalledWith("session-1", {
            displayText: "Change direction.",
            text: "Change direction.",
        });
    });

    it("keeps goal controls synchronized with responses and events", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        const activeGoal = {
            createdAt: 1,
            objective: "Finish the feature",
            status: "active" as const,
            updatedAt: 1,
        };
        const activeSession = { ...session, goal: activeGoal };
        const setGoal = vi.fn(async () => ({ session: activeSession }));
        const changeGoalStatus = vi.fn(async () => ({
            session: { ...activeSession, goal: { ...activeGoal, status: "paused" as const } },
        }));
        const clearGoal = vi.fn(async () => ({ session }));
        const agent = new RemoteAgent({
            client: { changeGoalStatus, clearGoal, setGoal } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            session,
        });

        await agent.setGoal(activeGoal.objective);
        expect(agent.goal).toEqual(activeGoal);
        await agent.changeGoalStatus("paused");
        expect(agent.goal?.status).toBe("paused");

        agent.applySessionEvent({
            createdAt: 2,
            data: { goal: { ...activeGoal, status: "blocked" } },
            id: "event-goal",
            sessionId: session.id,
            type: "goal_changed",
        });
        expect(agent.goal?.status).toBe("blocked");

        await agent.clearGoal();
        expect(agent.goal).toBeUndefined();
    });

    it("sends model-only text separately from its transcript label", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        const submitMessage = vi.fn(async () => ({
            eventId: "event-submit",
            runId: "run-1",
            sessionId: session.id,
        }));
        const watchSessionEvents = vi.fn(async (options) => {
            await options.onEvent({
                createdAt: 1,
                data: { modelLocked: false, runId: "run-1", stopReason: "stop" },
                id: "event-finished",
                sessionId: session.id,
                type: "run_finished",
            });
        });
        const agent = new RemoteAgent({
            client: { submitMessage, watchSessionEvents } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            session,
        });

        await agent.send("Expanded reviewer instructions", { displayText: "/review" });

        expect(submitMessage).toHaveBeenCalledWith(session.id, {
            content: [{ type: "text", text: "Expanded reviewer instructions" }],
            displayText: "/review",
            text: "/review",
        });
    });

    it("keeps models locked across effort changes and queued run boundaries", () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off", "high"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        const agent = new RemoteAgent({
            client: {} as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            session,
        });
        agent.applySessionEvent({
            createdAt: 1,
            data: {
                displayText: "Queued work",
                message: {
                    blocks: [{ text: "Queued work", type: "text" }],
                    id: "m1",
                    role: "user",
                },
                runId: "run-1",
            },
            id: "event-submitted",
            sessionId: session.id,
            type: "message_submitted",
        });
        agent.applySessionEvent({
            createdAt: 2,
            data: {
                effort: "high",
                modelId: model.id,
                snapshot: { ...session.snapshot, effort: "high" },
            },
            id: "event-effort",
            sessionId: session.id,
            type: "effort_changed",
        });
        expect(agent.canChangeModel).toBe(false);

        agent.applySessionEvent({
            createdAt: 3,
            data: { modelLocked: true, runId: "run-1", stopReason: "stop" },
            id: "event-finished-queued",
            sessionId: session.id,
            type: "run_finished",
        });
        expect(agent.canChangeModel).toBe(false);

        agent.applySessionEvent({
            createdAt: 4,
            data: { modelLocked: false, runId: "run-2", stopReason: "stop" },
            id: "event-finished-idle",
            sessionId: session.id,
            type: "run_finished",
        });
        expect(agent.canChangeModel).toBe(true);
    });

    it("updates the selected service tier through the remote protocol", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        const fastSession = {
            ...session,
            serviceTier: "fast" as const,
            snapshot: { ...session.snapshot, serviceTier: "fast" as const },
        };
        const changeServiceTier = vi.fn(async (_sessionId, request) => ({
            session: request.serviceTier === "fast" ? fastSession : session,
        }));
        const agent = new RemoteAgent({
            client: { changeServiceTier } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: "codex",
                models: [model],
                providers: [{ models: [model], providerId: "codex", serviceTiers: ["fast"] }],
            },
            session,
        });

        expect(agent.provider.serviceTiers).toEqual(["fast"]);
        agent.setServiceTier("fast");

        expect(agent.snapshot().serviceTier).toBe("fast");
        await vi.waitFor(() =>
            expect(changeServiceTier).toHaveBeenCalledWith(session.id, {
                serviceTier: "fast",
            }),
        );
        await vi.waitFor(() => expect(agent.snapshot().serviceTier).toBe("fast"));

        agent.setServiceTier(undefined);
        expect(agent.snapshot().serviceTier).toBeUndefined();
        await vi.waitFor(() => expect(changeServiceTier).toHaveBeenLastCalledWith(session.id, {}));
        await vi.waitFor(() => expect(agent.snapshot().serviceTier).toBeUndefined());
    });

    it("serializes rapid service-tier changes and ignores stale events", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        const fastSession: ProtocolSession = {
            ...session,
            serviceTier: "fast",
            snapshot: { ...session.snapshot, serviceTier: "fast" },
        };
        let resolveFast!: (value: { session: ProtocolSession }) => void;
        let resolveOff!: (value: { session: ProtocolSession }) => void;
        const fastResponse = new Promise<{ session: ProtocolSession }>((resolve) => {
            resolveFast = resolve;
        });
        const offResponse = new Promise<{ session: ProtocolSession }>((resolve) => {
            resolveOff = resolve;
        });
        const changeServiceTier = vi.fn((_sessionId: string, request: { serviceTier?: "fast" }) =>
            request.serviceTier === "fast" ? fastResponse : offResponse,
        );
        const agent = new RemoteAgent({
            client: { changeServiceTier } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: "codex",
                models: [model],
                providers: [{ models: [model], providerId: "codex", serviceTiers: ["fast"] }],
            },
            session,
        });

        const enable = agent.setServiceTier("fast");
        const disable = agent.setServiceTier(undefined);

        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(agent.confirmedServiceTier).toBeUndefined();
        await vi.waitFor(() => expect(changeServiceTier).toHaveBeenCalledTimes(1));
        expect(changeServiceTier).toHaveBeenNthCalledWith(1, session.id, {
            serviceTier: "fast",
        });
        agent.applySessionEvent({
            createdAt: 1,
            data: { serviceTier: "fast", snapshot: fastSession.snapshot },
            id: "event-fast",
            sessionId: session.id,
            type: "service_tier_changed",
        });
        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(agent.confirmedServiceTier).toBe("fast");

        resolveFast({ session: fastSession });
        await enable;
        await vi.waitFor(() => expect(changeServiceTier).toHaveBeenCalledTimes(2));
        expect(changeServiceTier).toHaveBeenNthCalledWith(2, session.id, {});
        expect(agent.snapshot().serviceTier).toBeUndefined();

        resolveOff({ session });
        await disable;
        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(agent.confirmedServiceTier).toBeUndefined();
    });

    it("rolls back a rejected service-tier change and keeps the queue usable", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        const fastSession: ProtocolSession = {
            ...session,
            serviceTier: "fast",
            snapshot: { ...session.snapshot, serviceTier: "fast" },
        };
        const changeServiceTier = vi
            .fn()
            .mockRejectedValueOnce(new Error("daemon unavailable"))
            .mockResolvedValueOnce({ session: fastSession });
        const agent = new RemoteAgent({
            client: { changeServiceTier } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: "codex",
                models: [model],
                providers: [{ models: [model], providerId: "codex", serviceTiers: ["fast"] }],
            },
            session,
        });

        const rejected = agent.setServiceTier("fast");
        expect(agent.snapshot().serviceTier).toBe("fast");
        expect(agent.confirmedServiceTier).toBeUndefined();
        await expect(rejected).rejects.toThrow("daemon unavailable");
        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(agent.confirmedServiceTier).toBeUndefined();

        await expect(agent.setServiceTier("fast")).resolves.toBeUndefined();
        expect(agent.snapshot().serviceTier).toBe("fast");
        expect(changeServiceTier).toHaveBeenCalledTimes(2);
    });

    it("keeps pending fast intent separate from authoritative session events", async () => {
        const model = defineModel({
            id: "openai/test",
            name: "Test model",
            thinkingLevels: ["off", "high"],
            defaultThinkingLevel: "off",
        });
        const session = protocolSession(model);
        let rejectChange!: (reason: Error) => void;
        const response = new Promise<never>((_resolve, reject) => {
            rejectChange = reject;
        });
        const changeServiceTier = vi.fn(() => response);
        const agent = new RemoteAgent({
            client: { changeServiceTier } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: {
                defaultModelId: model.id,
                defaultProviderId: "codex",
                models: [model],
                providers: [{ models: [model], providerId: "codex", serviceTiers: ["fast"] }],
            },
            session,
        });

        const pending = agent.setServiceTier("fast");
        await vi.waitFor(() => expect(changeServiceTier).toHaveBeenCalledOnce());
        const authoritativeSnapshot = { ...session.snapshot, effort: "high" };
        agent.applySessionEvent({
            createdAt: 1,
            data: { effort: "high", modelId: model.id, snapshot: authoritativeSnapshot },
            id: "event-effort",
            sessionId: session.id,
            type: "effort_changed",
        });
        expect(agent.snapshot().serviceTier).toBe("fast");
        expect(agent.confirmedServiceTier).toBeUndefined();

        agent.applySessionEvent({
            createdAt: 2,
            data: { snapshot: authoritativeSnapshot },
            id: "event-reset",
            sessionId: session.id,
            type: "session_reset",
        });
        expect(agent.snapshot().serviceTier).toBe("fast");
        expect(agent.confirmedServiceTier).toBeUndefined();
        agent.applySessionEvent({
            createdAt: 3,
            data: { messageId: "message-1", snapshot: authoritativeSnapshot },
            id: "event-rewound",
            sessionId: session.id,
            type: "session_rewound",
        });
        expect(agent.snapshot().serviceTier).toBe("fast");
        expect(agent.confirmedServiceTier).toBeUndefined();

        rejectChange(new Error("fast rejected"));
        await expect(pending).rejects.toThrow("fast rejected");
        expect(agent.snapshot().serviceTier).toBeUndefined();
        expect(agent.confirmedServiceTier).toBeUndefined();
    });

    it("restores the original model when rapid queued model changes both fail", async () => {
        const { firstModel, modelCatalog, secondModel, session, thirdModel } =
            remoteModelChangeFixture();
        const changeModel = vi
            .fn()
            .mockRejectedValueOnce(new Error("second rejected"))
            .mockRejectedValueOnce(new Error("third rejected"));
        const agent = new RemoteAgent({
            client: { changeModel } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog,
            session,
        });

        const secondChange = agent.setModel(secondModel.id, "off", "codex");
        const thirdChange = agent.setModel(thirdModel.id, "off", "codex");
        const secondResult = expect(secondChange).rejects.toThrow("second rejected");
        const thirdResult = expect(thirdChange).rejects.toThrow("third rejected");

        expect(agent.model.id).toBe(thirdModel.id);
        await secondResult;
        await thirdResult;
        expect(agent.model.id).toBe(firstModel.id);
        expect(agent.snapshot().modelId).toBe(firstModel.id);
    });

    it("restores the last confirmed model when a later queued change fails", async () => {
        const { modelCatalog, secondModel, session, thirdModel } = remoteModelChangeFixture();
        const secondSession: ProtocolSession = {
            ...session,
            modelId: secondModel.id,
            snapshot: { ...session.snapshot, modelId: secondModel.id },
        };
        const changeModel = vi
            .fn()
            .mockResolvedValueOnce({ session: secondSession })
            .mockRejectedValueOnce(new Error("third rejected"));
        const agent = new RemoteAgent({
            client: { changeModel } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog,
            session,
        });

        const secondChange = agent.setModel(secondModel.id, "off", "codex");
        const thirdChange = agent.setModel(thirdModel.id, "off", "codex");
        const secondResult = expect(secondChange).resolves.toBeUndefined();
        const thirdResult = expect(thirdChange).rejects.toThrow("third rejected");

        expect(agent.model.id).toBe(thirdModel.id);
        await secondResult;
        await thirdResult;
        expect(agent.model.id).toBe(secondModel.id);
        expect(agent.snapshot().modelId).toBe(secondModel.id);
    });

    it("clears fast mode immediately when changing to an unsupported provider", async () => {
        const codexModel = defineModel({
            id: "openai/test",
            name: "Codex test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const claudeModel = defineModel({
            id: "anthropic/test",
            name: "Claude test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const baseSession = protocolSession(codexModel);
        const session = {
            ...baseSession,
            serviceTier: "fast" as const,
            snapshot: { ...baseSession.snapshot, serviceTier: "fast" as const },
        };
        const changeModel = vi.fn(() => new Promise<never>(() => undefined));
        const agent = new RemoteAgent({
            client: { changeModel } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: {
                defaultModelId: codexModel.id,
                defaultProviderId: "codex",
                models: [codexModel, claudeModel],
                providers: [
                    {
                        models: [codexModel],
                        providerId: "codex",
                        serviceTiers: ["fast"],
                    },
                    { models: [claudeModel], providerId: "claude-sdk" },
                ],
            },
            session,
        });

        agent.setModel(claudeModel.id, "off", "claude-sdk");

        expect(agent.snapshot()).toMatchObject({
            modelId: claudeModel.id,
            providerId: "claude-sdk",
        });
        expect(agent.snapshot().serviceTier).toBeUndefined();
        await vi.waitFor(() =>
            expect(changeModel).toHaveBeenCalledWith(session.id, {
                effort: "off",
                modelId: claudeModel.id,
                providerId: "claude-sdk",
            }),
        );
    });

    it("restores fast mode when an unsupported-provider change is rejected", async () => {
        const codexModel = defineModel({
            id: "openai/test",
            name: "Codex test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const claudeModel = defineModel({
            id: "anthropic/test",
            name: "Claude test",
            thinkingLevels: ["off"],
            defaultThinkingLevel: "off",
        });
        const baseSession = protocolSession(codexModel);
        const session: ProtocolSession = {
            ...baseSession,
            serviceTier: "fast",
            snapshot: { ...baseSession.snapshot, serviceTier: "fast" },
        };
        const changeModel = vi.fn().mockRejectedValue(new Error("model change failed"));
        const agent = new RemoteAgent({
            client: { changeModel } as unknown as ProtocolHttpClient,
            context: createJustBashToolHarness().context,
            modelCatalog: {
                defaultModelId: codexModel.id,
                defaultProviderId: "codex",
                models: [codexModel, claudeModel],
                providers: [
                    {
                        models: [codexModel],
                        providerId: "codex",
                        serviceTiers: ["fast"],
                    },
                    { models: [claudeModel], providerId: "claude-sdk" },
                ],
            },
            session,
        });

        const change = agent.setModel(claudeModel.id, "off", "claude-sdk");
        expect(change).toBeDefined();
        expect(agent.provider.id).toBe("claude-sdk");
        expect(agent.snapshot().serviceTier).toBeUndefined();

        await expect(change).rejects.toThrow("model change failed");
        expect(agent.provider.id).toBe("codex");
        expect(agent.model.id).toBe(codexModel.id);
        expect(agent.snapshot().serviceTier).toBe("fast");
    });
});

function protocolSession(model: ReturnType<typeof defineModel>): ProtocolSession {
    return {
        agent: { depth: 0, rootSessionId: "session-1", type: "primary" },
        agentId: "agent-1",
        cwd: "/workspace",
        id: "session-1",
        modelId: model.id,
        modelLocked: false,
        models: [model],
        permissionMode: "workspace_write",
        mcpServers: [],
        pendingUserInputs: [],
        tasks: [],
        providerId: "codex",
        snapshot: {
            id: "agent-1",
            messages: [],
            modelId: model.id,
            providerId: "codex",
            queue: [],
            status: "idle",
            tools: [],
        },
        status: "idle",
        titleStatus: "idle",
    };
}

function remoteModelChangeFixture(): {
    firstModel: ReturnType<typeof defineModel>;
    modelCatalog: ModelCatalog;
    secondModel: ReturnType<typeof defineModel>;
    session: ProtocolSession;
    thirdModel: ReturnType<typeof defineModel>;
} {
    const firstModel = defineModel({
        id: "openai/first",
        name: "First",
        thinkingLevels: ["off"],
        defaultThinkingLevel: "off",
    });
    const secondModel = defineModel({
        id: "openai/second",
        name: "Second",
        thinkingLevels: ["off"],
        defaultThinkingLevel: "off",
    });
    const thirdModel = defineModel({
        id: "openai/third",
        name: "Third",
        thinkingLevels: ["off"],
        defaultThinkingLevel: "off",
    });
    const models = [firstModel, secondModel, thirdModel];
    const session = { ...protocolSession(firstModel), models };
    return {
        firstModel,
        modelCatalog: {
            defaultModelId: firstModel.id,
            defaultProviderId: "codex",
            models,
            providers: [{ models, providerId: "codex", serviceTiers: ["fast"] }],
        },
        secondModel,
        session,
        thirdModel,
    };
}

function permissionEvent(
    sessionId: string,
    permissionMode: "auto" | "workspace_write" | "read_only" | "full_access",
): SessionEvent {
    return {
        createdAt: 1,
        data: { permissionMode },
        id: "event-1",
        sessionId,
        type: "permission_mode_changed",
    };
}
