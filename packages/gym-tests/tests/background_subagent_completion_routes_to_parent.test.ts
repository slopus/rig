import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
    createGym,
    renderTerminalSnapshotPng,
    terminalRowStyleRuns,
    type Gym,
} from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("background subagent completion routes to its parent", () => {
    it("reports deterministic child work and leaves the parent terminal usable", async () => {
        let childRunId: string | undefined;
        let parentInitialRunId: string | undefined;
        let spawnedAgentId: string | undefined;
        let parentObservedCompletion = false;
        let parentObservedSpawnResult = false;
        const gym = await createGym({
            cols: 92,
            inference(request, _callIndex) {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                const lastMessage = request.context.messages.at(-1);
                const lastText =
                    typeof lastMessage?.content === "string"
                        ? lastMessage.content
                        : (lastMessage?.content ?? [])
                              .filter((block) => block.type === "text")
                              .map((block) => block.text)
                              .join("");

                if (parentInitialRunId === undefined) {
                    parentInitialRunId = sessionId;
                    expect(lastMessage).toMatchObject({ role: "user" });
                    expect(lastText).toContain("Delegate a deterministic inspection task.");
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    message:
                                        "Inspect the delegated workflow and return the deterministic child result.",
                                    task_name: "inspect_workspace",
                                },
                                id: "spawn-inspection-agent",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (
                    lastText.includes(
                        "Inspect the delegated workflow and return the deterministic child result.",
                    )
                ) {
                    childRunId ??= sessionId;
                    expect(sessionId).toBe(childRunId);
                    expect(sessionId).not.toBe(parentInitialRunId);
                    expect(lastMessage).toMatchObject({ role: "user" });
                    return {
                        content: [{ text: "CHILD_DETERMINISTIC_RESULT", type: "text" }],
                        delayMs: 500,
                    };
                }

                const spawnResultMessage = [...request.context.messages]
                    .reverse()
                    .find(
                        (message) =>
                            message.role === "toolResult" && message.toolName === "spawn_agent",
                    );
                if (spawnResultMessage !== undefined && !parentObservedSpawnResult) {
                    const spawnResultText =
                        typeof spawnResultMessage.content === "string"
                            ? spawnResultMessage.content
                            : spawnResultMessage.content
                                  .filter((block) => block.type === "text")
                                  .map((block) => block.text)
                                  .join("");
                    expect(spawnResultMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "spawn_agent",
                    });
                    const parsed = JSON.parse(spawnResultText) as {
                        agent_id: string;
                        path: string;
                        task_name: string;
                    };
                    expect(parsed).toMatchObject({
                        path: "/root/inspect_workspace",
                        task_name: "inspect_workspace",
                    });
                    expect(parsed.agent_id).toBeTypeOf("string");
                    spawnedAgentId = parsed.agent_id;
                    parentObservedSpawnResult = true;
                }

                if (lastText.includes("<subagent-notification>")) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    expect(lastText).toContain("Task: inspect_workspace");
                    expect(lastText).toContain("Status: completed");
                    expect(lastText).toContain("Result: CHILD_DETERMINISTIC_RESULT");
                    parentObservedCompletion = true;
                    return {
                        content: [
                            {
                                text: "PARENT_ACKNOWLEDGED_SUBAGENT_RESULT",
                                type: "text",
                            },
                        ],
                    };
                }

                if (lastMessage?.role === "toolResult" && lastMessage.toolName === "spawn_agent") {
                    expect(sessionId).toBe(parentInitialRunId);
                    return {
                        content: [{ text: "PARENT_CONTINUING_AFTER_SPAWN", type: "text" }],
                        delayMs: 750,
                    };
                }

                expect(lastMessage).toMatchObject({ role: "user" });
                expect(lastText).toContain("Confirm the parent still accepts a follow-up.");
                return {
                    content: [{ text: "PARENT_FOLLOW_UP_ACCEPTED", type: "text" }],
                };
            },
            rows: 28,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("Delegate a deterministic inspection task.");
        gym.terminal.press("enter");

        const spawned = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Started background task Inspect workspace.") &&
                snapshot.scroll.atBottom,
            "human-readable background task start",
            30_000,
        );
        expect(spawned.text).toContain("Inspect workspace");
        expect(spawned.text).not.toContain("inspect_workspace");
        expect(spawned.text).not.toContain("spawn_agent");
        expect(spawned.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(spawned.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes('"Inspect workspace" completed in') &&
                snapshot.text.includes("PARENT_ACKNOWLEDGED_SUBAGENT_RESULT") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "child completion notification and parent acknowledgement",
            30_000,
        );
        expect(parentObservedSpawnResult).toBe(true);
        expect(parentObservedCompletion).toBe(true);
        expect(childRunId).toBeTypeOf("string");
        expect(spawnedAgentId).toBeTypeOf("string");
        expect(completed.rows).toHaveLength(28);
        expect(completed.scroll.visibleRows).toBe(28);
        expect(completed.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(completed.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(completed.text).toContain("gym off · /workspace");
        expect(completed.text).toContain("• Background work");
        expect(completed.text).toContain('└ "Inspect workspace" completed in');
        expect(completed.text).not.toContain('› "Inspect workspace" completed');
        const notificationTitleRow = completed.rows.findIndex((row) => row === "• Background work");
        const notificationRow = completed.rows.findIndex((row) =>
            row.includes('"Inspect workspace" completed in'),
        );
        expect(
            completed.cells
                .filter((cell) => cell.y === notificationRow)
                .every((cell) => cell.background === null),
        ).toBe(true);
        const continuingRow = completed.rows.findIndex((row) =>
            row.includes("PARENT_CONTINUING_AFTER_SPAWN"),
        );
        const acknowledgementRow = completed.rows.findIndex((row) =>
            row.includes("PARENT_ACKNOWLEDGED_SUBAGENT_RESULT"),
        );
        const composerRow = completed.rows.findIndex((row) =>
            row.includes("Ask Rig to do anything"),
        );
        expect(notificationTitleRow).toBeLessThan(notificationRow);
        expect(notificationRow).toBeLessThan(continuingRow);
        expect(continuingRow).toBeLessThan(acknowledgementRow);
        expect(acknowledgementRow).toBeLessThan(composerRow);
        expect(terminalRowStyleRuns(completed, notificationTitleRow)).toEqual([
            {
                background: null,
                bold: false,
                dim: false,
                foreground: { kind: "palette", index: 3 },
                italic: false,
                text: "•",
                x: 0,
            },
            {
                background: null,
                bold: true,
                dim: false,
                foreground: null,
                italic: false,
                text: "Background work",
                x: 2,
            },
        ]);
        expect(terminalRowStyleRuns(completed, notificationRow)).toEqual([
            {
                background: null,
                bold: false,
                dim: true,
                foreground: null,
                italic: false,
                text: "└",
                x: 2,
            },
            {
                background: null,
                bold: false,
                dim: false,
                foreground: null,
                italic: false,
                text: '"Inspect workspace" completed in 0s · 0 tokens.',
                x: 4,
            },
        ]);
        const screenshotDirectory = process.env.RIG_GYM_SCREENSHOT_DIR;
        if (screenshotDirectory !== undefined) {
            await renderTerminalSnapshotPng(
                completed,
                resolve(screenshotDirectory, "background-subagent-completed.png"),
            );
        }
        expect(completed.text).not.toContain("�");
        expect(completed.cursor.x).toBeLessThan(92);
        expect(completed.cursor.y).toBeLessThan(28);

        gym.terminal.type("/agents");
        gym.terminal.press("enter");
        const agents = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Completed · Inspect workspace") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "completed delegated work status",
        );
        expect(agents.text).toContain("Subagents");
        expect(agents.text).not.toContain("inspect_workspace");
        expect(agents.text).not.toContain("subagent-1");
        expect(agents.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(agents.scroll.topArrivalCount).toBe(baseline.topArrivalCount);

        gym.terminal.type("Confirm the parent still accepts a follow-up.");
        gym.terminal.press("enter");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_FOLLOW_UP_ACCEPTED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "parent follow-up after delegated work",
            30_000,
        );
        expect(followUp.rows).toHaveLength(28);
        expect(followUp.scroll.visibleRows).toBe(28);
        expect(followUp.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
        expect(followUp.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
        expect(followUp.text).toContain("gym off · /workspace");
        expect(followUp.text).not.toContain("�");
        expect(followUp.cursor.x).toBeLessThan(92);
        expect(followUp.cursor.y).toBeLessThan(28);

        const agentRequests = gym.inference.requests.filter(
            (request) => !request.options.sessionId?.endsWith(":title"),
        );
        const parentRequests = agentRequests.filter(
            (request) => request.options.sessionId !== childRunId,
        );
        const childRequests = agentRequests.filter(
            (request) => request.options.sessionId === childRunId,
        );
        expect(childRequests).toHaveLength(1);
        expect(parentRequests.length).toBeGreaterThanOrEqual(3);
        expect(
            parentRequests.some((request) =>
                request.context.messages.some(
                    (message) =>
                        message.role === "toolResult" && message.toolName === "spawn_agent",
                ),
            ),
        ).toBe(true);
    }, 120_000);
});
