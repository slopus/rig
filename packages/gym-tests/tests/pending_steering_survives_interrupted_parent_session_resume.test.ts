import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();
const RESUME_MARKER = "PENDING_STEERING_RESUME_BOUNDARY";
const PENDING_MESSAGE = "Preserve this direction across the interrupted parent session.";

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("pending steering from an aborted parent run across session resume", () => {
    it("promotes the same message ID once into the first inference after reconnecting", async () => {
        let parentSessionId: string | undefined;
        let childRunCount = 0;
        const gym = await createGym({
            cols: 96,
            entrypoint: [
                "bash",
                "-lc",
                [
                    "node /app/packages/rig/dist/main.js",
                    "node /app/packages/rig/dist/main.js daemon stop",
                    "node /workspace/inspect-pending-steering-recovery.mjs",
                    "node /app/packages/rig/dist/main.js daemon start",
                    `echo ${RESUME_MARKER}`,
                    "exec node /app/packages/rig/dist/main.js resume --last",
                ].join("; "),
            ],
            files: {
                "inspect-pending-steering-recovery.mjs": inspectPendingSteeringRecoveryScript,
            },
            inference(request) {
                const sessionId = request.options.sessionId;
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage?.content);

                if (sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Interrupted steering recovery", type: "text" }] };
                }
                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message: "Keep auditing until the parent session resumes.",
                                    task_name: "resume_boundary_audit",
                                },
                                id: "spawn-resume-boundary-audit",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (lastText.includes("Keep auditing until the parent session resumes.")) {
                    childRunCount += 1;
                    return {
                        content: [{ text: "STALE_CHILD_RESPONSE", type: "text" }],
                        delayMs: 60_000,
                    };
                }
                if (
                    sessionId === parentSessionId &&
                    lastMessage?.role === "toolResult" &&
                    lastMessage.toolName === "spawn_agent"
                ) {
                    return {
                        content: [{ text: "STALE_PARENT_RESPONSE", type: "text" }],
                        delayMs: 60_000,
                    };
                }
                if (lastText.includes("Continue the parent after reconnecting.")) {
                    const userTexts = request.context.messages.flatMap((message) =>
                        message.role === "user" ? [messageText(message.content)] : [],
                    );
                    expect(userTexts.filter((text) => text === PENDING_MESSAGE)).toHaveLength(1);
                    expect(childRunCount).toBe(1);
                    return {
                        content: [{ text: "RESUMED_WITH_PENDING_STEERING", type: "text" }],
                    };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
            rows: 60,
        });
        running.add(gym);

        submit(gym, "Start delegated work and keep the parent turn active.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 agent running · /agents to view") &&
                snapshot.text.includes("esc to interrupt") &&
                childRunCount === 1,
            "the parent and delegated work to be active",
            30_000,
        );

        submit(gym, PENDING_MESSAGE);
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Messages to be submitted after next tool call") &&
                snapshot.text.includes(PENDING_MESSAGE),
            "the steering message to be pending before interruption",
            30_000,
        );

        gym.terminal.press("ctrlD");
        const reconnected = await gym.terminal.waitUntil(
            (snapshot) => {
                const marker = snapshot.text.indexOf(RESUME_MARKER);
                if (marker < 0) return false;
                const resumed = snapshot.text.slice(marker);
                return (
                    resumed.includes(PENDING_MESSAGE) &&
                    resumed.includes("Ask Rig to do anything") &&
                    !resumed.includes("Messages to be submitted after next tool call") &&
                    !resumed.includes("agent running · /agents to view")
                );
            },
            "the same parent session to reconnect with durable steering promoted",
            30_000,
        );
        expect(reconnected.text.slice(reconnected.text.indexOf(RESUME_MARKER))).not.toContain(
            "STALE_PARENT_RESPONSE",
        );
        expect(reconnected.text.slice(reconnected.text.indexOf(RESUME_MARKER))).not.toContain(
            "STALE_CHILD_RESPONSE",
        );
        // Before the abort-path correction, this same checkpoint contained the steer submission
        // but no matching steering_applied event or stored message. Assert the repaired durable
        // sequence before relying on the replayed UI or the next inference context.
        const persisted = JSON.parse(await gym.readFile("pending-steering-recovery.json")) as {
            appliedEventId: string;
            appliedMessageIds: string[];
            appliedRunId: string;
            appliedSeq: number;
            finishedEventId: string;
            finishedRunId: string;
            finishedSeq: number;
            finishedStopReason: string;
            storedCount: number;
            submittedEventId: string;
            submittedMessageId: string;
            submittedRunId: string;
            submittedSeq: number;
        };
        expect(persisted.appliedMessageIds).toEqual([persisted.submittedMessageId]);
        expect(persisted.appliedRunId).toBe(persisted.submittedRunId);
        expect(persisted.finishedRunId).toBe(persisted.submittedRunId);
        expect(persisted.finishedStopReason).toBe("aborted");
        expect(persisted.submittedEventId).not.toBe(persisted.appliedEventId);
        expect(persisted.appliedEventId).not.toBe(persisted.finishedEventId);
        expect(persisted.submittedSeq).toBeLessThan(persisted.appliedSeq);
        expect(persisted.appliedSeq).toBeLessThan(persisted.finishedSeq);
        expect(persisted.storedCount).toBe(1);

        submit(gym, "Continue the parent after reconnecting.");
        const resumed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("RESUMED_WITH_PENDING_STEERING") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                !snapshot.text.includes("Messages to be submitted after next tool call"),
            "the immediate resumed inference to include the old steering exactly once",
            30_000,
        );
        const resumedText = resumed.text.slice(resumed.text.indexOf(RESUME_MARKER));
        expect(countOccurrences(resumedText, PENDING_MESSAGE)).toBe(1);
        expect(resumedText).not.toContain("STALE_PARENT_RESPONSE");
        expect(resumedText).not.toContain("STALE_CHILD_RESPONSE");
        await screenshot(gym, "revised-pending-resume-boundary.png");
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}

function countOccurrences(text: string, value: string): number {
    return text.split(value).length - 1;
}

async function screenshot(gym: Gym, name: string): Promise<void> {
    const directory = process.env.RIG_GYM_SCREENSHOT_DIR;
    if (directory === undefined) return;
    await gym.terminal.screenshot(resolve(directory, name));
}

const inspectPendingSteeringRecoveryScript = `
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/home/rig/.rig/sessions.sqlite");
const sessionId = database
    .prepare("SELECT id FROM sessions WHERE parent_session_id IS NULL ORDER BY created_at_ms DESC LIMIT 1")
    .get().id;
const events = database
    .prepare("SELECT seq, event_id, type, data_json FROM session_events WHERE session_id = ? ORDER BY seq")
    .all(sessionId)
    .map((event) => ({ ...event, data: JSON.parse(event.data_json) }));
const submitted = events.filter(
    (event) =>
        event.type === "message_submitted" &&
        event.data.delivery === "steer" &&
        event.data.displayText === ${JSON.stringify(PENDING_MESSAGE)},
);
if (submitted.length !== 1) {
    throw new Error("Expected one pending steering submission, found " + submitted.length);
}
const submittedEvent = submitted[0];
const messageId = submittedEvent.data.message.id;
const applied = events.filter(
    (event) =>
        event.type === "steering_applied" &&
        event.data.messageIds.includes(messageId),
);
if (applied.length !== 1) {
    throw new Error("Expected one steering application, found " + applied.length);
}
const appliedEvent = applied[0];
const finished = events.filter(
    (event) =>
        event.type === "run_finished" &&
        event.data.runId === submittedEvent.data.runId,
);
if (finished.length !== 1) {
    throw new Error("Expected one terminal run event, found " + finished.length);
}
const finishedEvent = finished[0];
const storedCount = database
    .prepare("SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ? AND message_id = ?")
    .get(sessionId, messageId).count;
database.close();
writeFileSync(
    "/workspace/pending-steering-recovery.json",
    JSON.stringify({
        appliedEventId: appliedEvent.event_id,
        appliedMessageIds: appliedEvent.data.messageIds,
        appliedRunId: appliedEvent.data.runId,
        appliedSeq: appliedEvent.seq,
        finishedEventId: finishedEvent.event_id,
        finishedRunId: finishedEvent.data.runId,
        finishedSeq: finishedEvent.seq,
        finishedStopReason: finishedEvent.data.stopReason,
        storedCount,
        submittedEventId: submittedEvent.event_id,
        submittedMessageId: messageId,
        submittedRunId: submittedEvent.data.runId,
        submittedSeq: submittedEvent.seq,
    }),
);
`;
