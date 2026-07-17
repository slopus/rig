import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("delayed subagent completion does not add blank scrollback", () => {
    it("keeps the parent response, completion notice, and composer together", async () => {
        const releaseFirstChild = deferred<void>();
        const releaseSecondChild = deferred<void>();
        let parentSessionId: string | undefined;
        let firstChildSessionId: string | undefined;
        let secondChildSessionId: string | undefined;
        const longParentResponse = [
            "PARENT_RESPONSE_BEGIN",
            ...Array.from(
                { length: 70 },
                (_, index) => `Parent audit finding ${String(index).padStart(2, "0")}`,
            ),
            "PARENT_FINISHED_BEFORE_CHILD",
        ].join("\n");
        const gym = await createGym({
            cols: 92,
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                expect(sessionId).toBeTypeOf("string");
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage?.content);

                if (sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Delayed subagent audit", type: "text" }] };
                }

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            ...Array.from({ length: 6 }, (_, index) => ({
                                arguments: {
                                    cmd: `printf 'TOOL_${index}_BEGIN\\n'; seq 1 18; printf 'TOOL_${index}_END\\n'`,
                                },
                                id: `audit-tool-${index}`,
                                name: "exec_command",
                                type: "toolCall" as const,
                            })),
                            {
                                arguments: {
                                    context: "task",
                                    message:
                                        "Wait until released, then report FIRST_CHILD_COMPLETE.",
                                    task_name: "first_delayed_audit",
                                },
                                id: "spawn-first-delayed-audit",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                            {
                                arguments: {
                                    context: "task",
                                    message:
                                        "Wait until released, then report SECOND_CHILD_COMPLETE.",
                                    task_name: "second_delayed_audit",
                                },
                                id: "spawn-second-delayed-audit",
                                name: "spawn_agent",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Wait until released, then report FIRST_CHILD_COMPLETE.")) {
                    firstChildSessionId ??= sessionId;
                    expect(sessionId).toBe(firstChildSessionId);
                    await releaseFirstChild.promise;
                    return { content: [{ text: "FIRST_CHILD_COMPLETE", type: "text" }] };
                }

                if (lastText.includes("Wait until released, then report SECOND_CHILD_COMPLETE.")) {
                    secondChildSessionId ??= sessionId;
                    expect(sessionId).toBe(secondChildSessionId);
                    await releaseSecondChild.promise;
                    return { content: [{ text: "SECOND_CHILD_COMPLETE", type: "text" }] };
                }

                if (lastText.includes("<subagent-notification>")) {
                    return {
                        content: [
                            {
                                text: lastText.includes("FIRST_CHILD_COMPLETE")
                                    ? "PARENT_ACKNOWLEDGED_FIRST_CHILD"
                                    : "PARENT_ACKNOWLEDGED_SECOND_CHILD",
                                type: "text",
                            },
                        ],
                        delayMs: 1_000,
                    };
                }

                if (lastText.includes("How does persistent goal setting work?")) {
                    return {
                        content: [
                            {
                                text: "GOAL_FOLLOW_UP_FINISHED_WHILE_AGENTS_RUN",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(lastMessage?.role).toBe("toolResult");
                return { content: [{ text: longParentResponse, type: "text" }] };
            },
            rows: 28,
        });
        running.add(gym);

        submit(gym, "Run a parent audit and delegate one delayed check.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_FINISHED_BEFORE_CHILD") &&
                snapshot.text.includes("2 agents running · /agents to view") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "parent completion while delegated work remains active",
            30_000,
        );

        submit(gym, "How does persistent goal setting work?");
        const beforeCompletion = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("GOAL_FOLLOW_UP_FINISHED_WHILE_AGENTS_RUN") &&
                snapshot.text.includes("2 agents running · /agents to view") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up turn completed while both delegated tasks remain active",
            30_000,
        );
        const stableComposerRow = rowContaining(beforeCompletion, "Ask Rig to do anything");

        releaseFirstChild.resolve();
        const notified = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes('"First delayed audit" completed in') &&
                snapshot.text.includes("1 agent running · /agents to view") &&
                snapshot.scroll.atBottom,
            "delayed child completion notice",
            30_000,
        );
        expect(notified.text).toContain("Ask Rig to do anything");
        expect(notified.text).toContain("gym off · /workspace");
        expect(rowContaining(notified, "Ask Rig to do anything")).toBe(stableComposerRow);

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_ACKNOWLEDGED_FIRST_CHILD") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "parent acknowledgement after delayed child completion",
            30_000,
        );
        expect(completed.text).toContain('"First delayed audit" completed in');
        expect(completed.text).toContain("1 agent running · /agents to view");
        expect(completed.text).toContain("gym off · /workspace");
        expect(rowContaining(completed, "Ask Rig to do anything")).toBe(stableComposerRow);

        releaseSecondChild.resolve();
        const allCompleted = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes('"Second delayed audit" completed in') &&
                snapshot.text.includes("PARENT_ACKNOWLEDGED_SECOND_CHILD") &&
                !snapshot.text.includes("agent running · /agents to view") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "last child completion replaces the final live agent row",
            30_000,
        );
        expect(rowContaining(allCompleted, "Ask Rig to do anything")).toBe(stableComposerRow);

        const scrollbackRows = await collectScrollbackRows(gym);
        expect(countRowsContaining(scrollbackRows, "PARENT_RESPONSE_BEGIN")).toBe(1);
        expect(countRowsContaining(scrollbackRows, "PARENT_FINISHED_BEFORE_CHILD")).toBe(1);
        expect(countRowsContaining(scrollbackRows, '"First delayed audit" completed in')).toBe(1);
        expect(countRowsContaining(scrollbackRows, '"Second delayed audit" completed in')).toBe(1);
        expect(maxConsecutiveBlankRows(scrollbackRows)).toBeLessThanOrEqual(4);
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function deferred<T>(): { promise: Promise<T>; resolve: (value?: T) => void } {
    let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: (value) => resolvePromise(value as T),
    };
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
        .join("");
}

async function collectScrollbackRows(gym: Gym): Promise<string[]> {
    gym.terminal.scrollToTop();
    let snapshot = await gym.terminal.snapshot();
    const rows: string[] = [];

    for (;;) {
        if (snapshot.scroll.atBottom) {
            rows.push(...snapshot.rows);
            break;
        }

        rows.push(snapshot.rows[0] ?? "");
        const previousOffset = snapshot.scroll.offset;
        gym.terminal.scrollBy(1);
        snapshot = await gym.terminal.snapshot();
        if (snapshot.scroll.offset === previousOffset) {
            throw new Error(`Scrollback stopped advancing at offset ${previousOffset}.`);
        }
    }

    gym.terminal.scrollToBottom();
    return rows;
}

function countRowsContaining(rows: readonly string[], value: string): number {
    return rows.filter((row) => row.includes(value)).length;
}

function maxConsecutiveBlankRows(rows: readonly string[]): number {
    let maximum = 0;
    let current = 0;
    for (const row of rows) {
        if (row.trim().length === 0) {
            current += 1;
            maximum = Math.max(maximum, current);
        } else {
            current = 0;
        }
    }
    return maximum;
}

function rowContaining(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    text: string,
): number {
    const row = snapshot.rows.findIndex((candidate) => candidate.includes(text));
    expect(row).toBeGreaterThanOrEqual(0);
    return row;
}
