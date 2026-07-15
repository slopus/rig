import { describe, expect, it } from "vitest";

import type { SessionEvent } from "../protocol/index.js";
import type { PersistedSessionMessage } from "./InMemorySession.js";
import { createSessionMetadataTranscript } from "./createSessionMetadataTranscript.js";

describe("createSessionMetadataTranscript", () => {
    it("keeps real user text and only the final visible assistant block per turn", () => {
        const messages: PersistedSessionMessage[] = [
            entry(0, "run-1", false, "user", [{ type: "text", text: "Implement metadata." }]),
            entry(1, "run-1", false, "agent", [
                { type: "thinking", thinking: "hidden" },
                { type: "text", text: "Intermediate commentary." },
                { type: "tool_call", id: "tool-1", name: "exec", arguments: {} },
            ]),
            entry(2, "run-1", false, "agent", [
                { type: "text", text: "First final block." },
                { type: "text", text: "Actual final visible block." },
            ]),
            entry(3, "notice", false, "user", [{ type: "text", text: "Workflow finished." }]),
            entry(4, "run-2", false, "user", [{ type: "text", text: "Keep going." }]),
            entry(5, "run-2", true, "agent", [{ type: "text", text: "Interrupted answer" }]),
        ];
        const events = [
            {
                createdAt: 1,
                data: {
                    displayText: "Workflow finished.",
                    message: messages[3]?.message,
                    runId: "notice",
                    source: "notification",
                },
                id: "event-1",
                sessionId: "session-1",
                type: "message_submitted",
            },
        ] as SessionEvent[];

        const transcript = createSessionMetadataTranscript(messages, events);

        expect(transcript).toContain("User: Implement metadata.");
        expect(transcript).toContain("Assistant: Actual final visible block.");
        expect(transcript).not.toContain("Intermediate commentary");
        expect(transcript).not.toContain("Workflow finished");
        expect(transcript).toContain(
            "Assistant [persisted partial response from interrupted turn]: Interrupted answer",
        );
    });
});

function entry(
    position: number,
    runId: string,
    isPartial: boolean,
    role: "agent" | "user",
    blocks: PersistedSessionMessage["message"]["blocks"],
): PersistedSessionMessage {
    return {
        isPartial,
        message: { blocks, id: `message-${position}`, role } as PersistedSessionMessage["message"],
        position,
        runId,
    };
}
