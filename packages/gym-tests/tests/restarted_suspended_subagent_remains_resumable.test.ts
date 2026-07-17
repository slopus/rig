import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("restarted suspended subagent", () => {
    it("stays stopped, informs the parent, and resumes only through resume_agent", async () => {
        let childRunCount = 0;
        const gym = await createGym({
            cols: 92,
            entrypoint: [
                "bash",
                "-lc",
                [
                    "node /app/packages/rig/dist/main.js",
                    "node /app/packages/rig/dist/main.js daemon stop",
                    "node /workspace/mark-suspended-active-run.mjs",
                    "node /app/packages/rig/dist/main.js daemon start",
                    "node /workspace/inspect-repaired-subagent.mjs",
                    "exec node /app/packages/rig/dist/main.js resume --last",
                ].join("; "),
            ],
            files: {
                "mark-suspended-active-run.mjs": markSuspendedActiveRunScript,
                "inspect-repaired-subagent.mjs": inspectRepairedSubagentScript,
            },
            inference(request) {
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage?.content);
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Restarted delegation", type: "text" }] };
                }
                if (lastText.includes("Start a restart-sensitive delegated audit.")) {
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message: "Audit until explicitly resumed after restart.",
                                    task_name: "restart_audit",
                                },
                                id: "spawn-restart-audit",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (lastText.includes("Audit until explicitly resumed after restart.")) {
                    childRunCount += 1;
                    return {
                        content: [{ text: "STALE_CHILD_AFTER_RESTART", type: "text" }],
                        delayMs: 30_000,
                    };
                }
                if (lastText.includes("Resume the stopped delegated audit now.")) {
                    expect(childRunCount).toBe(1);
                    expect(
                        request.context.messages
                            .map((message) => messageText(message.content))
                            .join("\n"),
                    ).toContain("stopped working when the local server restarted");
                    return {
                        content: [
                            {
                                arguments: { target: "restart_audit" },
                                id: "resume-restart-audit",
                                name: "resume_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (lastText.includes("Continue the delegated task from where you stopped")) {
                    childRunCount += 1;
                    return { content: [{ text: "RESTARTED_CHILD_RECOVERED", type: "text" }] };
                }
                if (lastText.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_SAW_RECOVERED_CHILD", type: "text" }] };
                }
                if (lastMessage?.role === "toolResult") {
                    if (lastMessage.toolName === "resume_agent") {
                        expect(lastMessage.isError).toBe(false);
                        return {
                            content: [{ text: "PARENT_RESUMED_RESTARTED_CHILD", type: "text" }],
                        };
                    }
                    return {
                        content: [{ text: "STALE_PARENT_AFTER_RESTART", type: "text" }],
                        delayMs: 30_000,
                    };
                }
                throw new Error(`Unexpected inference request: ${lastText}`);
            },
            rows: 28,
        });
        running.add(gym);

        submit(gym, "Start a restart-sensitive delegated audit.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 agent running · /agents to view") &&
                snapshot.text.includes("esc to interrupt") &&
                childRunCount === 1,
            "the parent and restart-sensitive child to be active",
            30_000,
        );

        gym.terminal.press("escape");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("1 subagent was suspended: Restart audit") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                !snapshot.text.includes("esc to interrupt"),
            "the delegated audit to suspend",
            30_000,
        );
        gym.terminal.press("ctrlD");

        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes(
                    '"Restart audit" stopped when the local server restarted.',
                ) && snapshot.text.includes("Ask Rig to do anything"),
            "the restarted parent session",
            30_000,
        );
        const repairedState = JSON.parse(await gym.readFile("repaired-subagent-state.json")) as {
            child: { active_run_id: string | null; status: string };
            parentEvent: { data_json: string; type: string };
        };
        expect(repairedState.child).toEqual({ active_run_id: null, status: "suspended" });
        expect(repairedState.parentEvent.type).toBe("message_submitted");
        expect(repairedState.parentEvent.data_json).toContain(
            "stopped when the local server restarted",
        );
        const restarted = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes(
                    '"Restart audit" stopped when the local server restarted.',
                ) && snapshot.text.includes("Ask Rig to do anything"),
            "the restarted parent with a durable stopped-work notification",
            30_000,
        );
        expect(restarted.text).not.toContain("STALE_CHILD_AFTER_RESTART");
        expect(childRunCount).toBe(1);

        submit(gym, "/agents");
        await gym.terminal.waitForText("Suspended · Restart audit", 30_000);
        expect(childRunCount).toBe(1);

        submit(gym, "Resume the stopped delegated audit now.");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_RESUMED_RESTARTED_CHILD") &&
                snapshot.text.includes('"Restart audit" completed in'),
            "resume_agent to recover the restarted suspended child",
            30_000,
        );
        expect(childRunCount).toBe(2);
        expect(recovered.text).not.toContain("Only a suspended subagent can be resumed");
        expect(recovered.text).not.toContain("STALE_PARENT_AFTER_RESTART");
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

const markSuspendedActiveRunScript = `
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync("/home/rig/.rig/sessions.sqlite");
const result = database
    .prepare("UPDATE sessions SET active_run_id = 'stale-suspended-run' WHERE status = 'suspended' AND parent_session_id IS NOT NULL")
    .run();
database.close();
if (result.changes !== 1) {
    throw new Error("Expected exactly one suspended subagent, updated " + result.changes);
}
`;

const inspectRepairedSubagentScript = `
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

try {
    const database = new DatabaseSync("/home/rig/.rig/sessions.sqlite");
    const child = database
        .prepare("SELECT status, active_run_id FROM sessions WHERE parent_session_id IS NOT NULL")
        .get();
    const parentEvent = database
        .prepare("SELECT type, data_json FROM session_events WHERE session_id = (SELECT id FROM sessions WHERE parent_session_id IS NULL LIMIT 1) ORDER BY seq DESC LIMIT 1")
        .get();
    database.close();
    writeFileSync("/workspace/repaired-subagent-state.json", JSON.stringify({ child, parentEvent }));
} catch (error) {
    writeFileSync("/workspace/repaired-subagent-state.json", String(error?.stack ?? error));
}
`;
