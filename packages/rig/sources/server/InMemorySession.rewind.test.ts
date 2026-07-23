import { describe, expect, it, vi } from "vitest";

import { createEventIdFactory, type ModelCatalog } from "../protocol/index.js";
import { defineModel } from "@slopus/rig-execution";
import {
    InMemorySession,
    type InMemorySessionPersistence,
    type PersistedSessionState,
} from "./InMemorySession.js";

describe("InMemorySession rewind", () => {
    it("removes the selected user turn and everything after it", () => {
        const deleteMessagesFrom = vi.fn();
        const session = createRestoredSession(deleteMessagesFrom);

        const result = session.rewind("user-2");

        expect(result.message).toMatchObject({ id: "user-2", role: "user" });
        expect(result.session.snapshot.messages.map((message) => message.id)).toEqual([
            "user-1",
            "agent-1",
        ]);
        expect(deleteMessagesFrom).toHaveBeenCalledWith("session-1", 2);
        expect(session.events.since(undefined)?.at(-1)).toMatchObject({
            data: {
                messageId: "user-2",
                snapshot: { messages: [{ id: "user-1" }, { id: "agent-1" }] },
            },
            type: "session_rewound",
        });
    });

    it("rejects a message that is not a visible user turn", () => {
        const session = createRestoredSession(vi.fn());

        expect(() => session.rewind("agent-1")).toThrow(
            "The selected user message is no longer available.",
        );
        expect(() => session.rewind("missing")).toThrow(
            "The selected user message is no longer available.",
        );
    });
});

function createRestoredSession(deleteMessagesFrom: (sessionId: string, position: number) => void) {
    const model = defineModel({
        defaultThinkingLevel: "medium",
        id: "test/model",
        name: "Test model",
        thinkingLevels: ["medium"],
    });
    const modelCatalog: ModelCatalog = {
        defaultModelId: model.id,
        defaultProviderId: "test",
        models: [model],
        providers: [{ models: [model], providerId: "test" }],
    };
    const messages = [
        { blocks: [{ text: "First", type: "text" as const }], id: "user-1", role: "user" as const },
        {
            blocks: [{ text: "Reply", type: "text" as const }],
            id: "agent-1",
            role: "agent" as const,
        },
        {
            blocks: [{ text: "Second", type: "text" as const }],
            id: "user-2",
            role: "user" as const,
        },
        {
            blocks: [{ text: "Later", type: "text" as const }],
            id: "agent-2",
            role: "agent" as const,
        },
    ];
    const restore: PersistedSessionState = {
        agent: { depth: 0, rootSessionId: "session-1", type: "primary" },
        agentId: "agent",
        contextMessages: messages,
        cwd: "/tmp/rig-rewind-test",
        id: "session-1",
        messages: messages.map((message, position) => ({
            isPartial: false,
            message,
            position,
        })),
        modelId: model.id,
        models: [model],
        nextTaskId: 1,
        permissionMode: "workspace_write",
        providerId: "test",
        queuedRuns: [],
        status: "completed",
        tasks: [],
        titleStatus: "ready",
        tools: [],
    };
    const persistence: InMemorySessionPersistence = {
        clearMessages: vi.fn(),
        deleteMessagesFrom,
        deleteQueuedRun: vi.fn(),
        insertQueuedRun: vi.fn(),
        saveSession: vi.fn(),
        upsertMessage: vi.fn(),
    };
    return new InMemorySession({
        createEventId: createEventIdFactory(),
        modelCatalog,
        persistence,
        request: { cwd: restore.cwd },
        restore,
    });
}
