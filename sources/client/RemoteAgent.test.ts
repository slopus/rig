import { describe, expect, it, vi } from "vitest";

import { createPermissionContext } from "../permissions/index.js";
import { defineModel } from "../providers/types.js";
import type { ProtocolSession, SessionEvent } from "../protocol/index.js";
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

        expect(agent.permissionMode).toBe("full_access");
        expect(harness.context.permissions.mode).toBe("full_access");
        await vi.waitFor(() => expect(changePermissionMode).toHaveBeenCalledOnce());

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
