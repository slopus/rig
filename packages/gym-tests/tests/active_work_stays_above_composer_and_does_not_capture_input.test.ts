import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("passive active-work list", () => {
    it("stays above the composer while multiline input remains usable", async () => {
        let parentSessionId: string | undefined;
        let releaseWorkflow: (() => void) | undefined;
        const workflowCanFinish = new Promise<void>((resolve) => {
            releaseWorkflow = resolve;
        });
        const gym = await createGym({
            cols: 100,
            inference: async (request) => {
                const sessionId = request.options.sessionId;
                const lastText = messageText(request.context.messages.at(-1));

                if (parentSessionId === undefined) {
                    parentSessionId = sessionId;
                    return {
                        content: [
                            {
                                arguments: {
                                    description: "Keep one visible workflow active",
                                    name: "visible-workflow",
                                    script: [
                                        'phase("Inspect")',
                                        'agent("Wait, then return WORKFLOW_FINISHED only.", {"label": "Visible child"})',
                                        '"done"',
                                    ].join("\n"),
                                },
                                id: "start-visible-workflow",
                                name: "workflow",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (lastText.includes("Wait, then return WORKFLOW_FINISHED only.")) {
                    expect(sessionId).not.toBe(parentSessionId);
                    await workflowCanFinish;
                    return { content: [{ text: "WORKFLOW_FINISHED", type: "text" }] };
                }

                if (lastText === "first line\nsecond line") {
                    return { content: [{ text: "MULTILINE_SENT_DURING_WORKFLOW", type: "text" }] };
                }

                const launched = request.context.messages.some(
                    (message) => message.role === "toolResult" && message.toolName === "workflow",
                );
                if (launched && !lastText.includes("<workflow-notification>")) {
                    return { content: [{ text: "WORKFLOW_RUNNING", type: "text" }] };
                }
                if (lastText.includes("<workflow-notification>")) {
                    return { content: [{ text: "WORKFLOW_NOTIFICATION_ACK", type: "text" }] };
                }

                throw new Error(`Unexpected inference request: ${lastText}`);
            },
            rows: 30,
        });
        running.add(gym);

        try {
            submit(gym, "Start one visible workflow.");
            const passiveList = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("WORKFLOW_RUNNING") &&
                    snapshot.text.includes("1 workflow running · /workflows to view") &&
                    snapshot.text.includes("gym off · /workspace · full access"),
                "workflow row above the composer",
                30_000,
            );
            const statusRow = passiveList.rows.findIndex((row) => row.includes("gym off"));
            const workflowRow = passiveList.rows.findIndex((row) =>
                row.includes("1 workflow running"),
            );
            const composerRow = passiveList.rows.findIndex((row) =>
                row.includes("Ask Rig to do anything"),
            );
            expect(statusRow).toBeGreaterThanOrEqual(0);
            expect(workflowRow).toBeLessThan(composerRow);
            expect(composerRow).toBeLessThan(statusRow);
            expect(passiveList.text).not.toContain("Active work");
            expect(passiveList.text).not.toContain("Workflow Visible workflow");
            expect(passiveList.text).not.toContain("select");
            expect(passiveList.text).not.toContain("Enter opens");
            expect(passiveList.text).not.toContain("→ Workflow");

            gym.terminal.type("first line");
            gym.terminal.write("\x1b[13;2~");
            gym.terminal.type("second line");
            const multiline = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("first line") &&
                    snapshot.text.includes("second line") &&
                    snapshot.text.includes("1 workflow running · /workflows to view"),
                "multiline draft while workflow remains visible",
                30_000,
            );
            expect(multiline.text).not.toContain("Workflows\n");

            gym.terminal.press("enter");
            const sent = await gym.terminal.waitForText("MULTILINE_SENT_DURING_WORKFLOW", 30_000);
            expect(sent.text).toContain("1 workflow running · /workflows to view");
            const stableComposerRow = sent.rows.findIndex((row) =>
                row.includes("Ask Rig to do anything"),
            );

            releaseWorkflow?.();
            const completed = await gym.terminal.waitUntil(
                (snapshot) =>
                    snapshot.text.includes("Workflow Visible workflow completed.") &&
                    snapshot.text.includes("WORKFLOW_NOTIFICATION_ACK") &&
                    !snapshot.text.includes("workflow running · /workflows to view") &&
                    snapshot.text.includes("Ask Rig to do anything"),
                "workflow completion moved from live status into history",
                30_000,
            );
            expect(completed.rows.findIndex((row) => row.includes("Ask Rig to do anything"))).toBe(
                stableComposerRow,
            );
        } finally {
            releaseWorkflow?.();
        }
    }, 120_000);
});

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function messageText(message: { content: unknown } | undefined): string {
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content
        .filter(
            (block): block is { text: string; type: "text" } =>
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "text" &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}
