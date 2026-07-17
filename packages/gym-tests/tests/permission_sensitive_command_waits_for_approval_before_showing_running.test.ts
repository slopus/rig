import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("permission-sensitive command waits for approval before showing Running", () => {
    it("shows the exact proposed action, then truthfully transitions through execution", async () => {
        const command =
            "printf 'COMMAND_STARTED\\n'; while [ ! -e .release-approved-command ]; do sleep 0.05; done; rm .release-approved-command; printf 'approved after prompt\\n' > approved-after-prompt.txt; printf 'COMMAND_FINISHED\\n'";
        const gym = await createGym({
            cols: 100,
            inference(request, callIndex) {
                const systemPrompt = request.context.systemPrompt ?? "";
                const lastMessage = request.context.messages.at(-1);

                if (systemPrompt.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    expect(messageText(lastMessage)).toContain("approved-after-prompt.txt");
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "ask",
                                    risk: "high",
                                    user_authorization: "medium",
                                    reason: "This writes a proof file after a deliberate delay.",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }

                if (callIndex === 0) {
                    expect(messageText(lastMessage)).toContain("ask before running");
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: command,
                                    justification: "Create the proof file only after approval.",
                                    sandbox_permissions: "require_escalated",
                                    workdir: "/workspace",
                                },
                                id: "approved-after-prompt-command",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    expect(messageText(lastMessage)).toContain("COMMAND_STARTED");
                    expect(messageText(lastMessage)).toContain("COMMAND_FINISHED");
                    return {
                        content: [{ text: "APPROVED_COMMAND_COMPLETE", type: "text" }],
                    };
                }

                expect(callIndex).toBe(3);
                expect(messageText(lastMessage)).toContain("Confirm the terminal is still healthy");
                return {
                    content: [{ text: "APPROVAL_FOLLOW_UP_COMPLETE", type: "text" }],
                };
            },
            rows: 30,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        gym.terminal.type("/permissions");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Auto.");

        gym.terminal.type("Use the proof command, but ask before running it.");
        gym.terminal.press("enter");

        const awaitingApproval = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Needs approval") &&
                snapshot.text.includes("Awaiting approval") &&
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("Deny") &&
                snapshot.scroll.atBottom,
            "the exact command awaiting one-time approval",
            30_000,
        );
        const awaitingText = normalizeWhitespace(awaitingApproval.text);
        expect(awaitingText).toContain("This writes a proof file after a deliberate delay.");
        expect(awaitingText).toContain("Allow running");
        expect(awaitingText).toContain(visibleExact(command));
        expect(awaitingText).toContain("Permit running");
        expect(awaitingApproval.text).toContain("• Awaiting approval printf");
        expect(awaitingApproval.text).toContain("◦ Waiting for approval");
        expect(awaitingApproval.text).not.toContain("• Running 1 tool");
        expect(awaitingApproval.text).not.toContain("• Running printf");
        expect(awaitingApproval.text).not.toContain("• Ran printf");
        expect(awaitingApproval.text).not.toContain("approved-after-prompt-command");
        await expect(gym.readFile("approved-after-prompt.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        assertTerminalHealth(awaitingApproval, baseline);

        gym.terminal.press("enter");
        const executing = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("• Running printf") &&
                !snapshot.text.includes("• Awaiting approval printf") &&
                !snapshot.text.includes("• Ran printf") &&
                snapshot.scroll.atBottom,
            "the approved command visibly running",
            30_000,
        );
        expect(executing.text).toContain(
            "Needs approval: This writes a proof file after a deliberate delay.",
        );
        expect(executing.text).not.toContain("Auto permission");
        assertTerminalHealth(executing, baseline);
        await gym.runInContainer("touch", [".release-approved-command"]);

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("• Ran printf") &&
                snapshot.text.includes("COMMAND_STARTED") &&
                snapshot.text.includes("APPROVED_COMMAND_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the approved command and turn completed",
            30_000,
        );
        expect(completed.text).not.toContain("• Running printf");
        expect(completed.text).not.toContain("• Awaiting approval printf");
        expect(completed.text).not.toContain("exec_command");
        expect(completed.rows.some((row) => /^─+$/u.test(row))).toBe(true);
        await expect(gym.readFile("approved-after-prompt.txt")).resolves.toBe(
            "approved after prompt\n",
        );
        assertTerminalHealth(completed, baseline);

        gym.terminal.type("Confirm the terminal is still healthy.");
        gym.terminal.press("enter");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("APPROVAL_FOLLOW_UP_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy follow-up after approval",
            30_000,
        );
        expect(followUp.text).not.toContain("�");
        assertTerminalHealth(followUp, baseline);
    }, 120_000);
});

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
        .join("");
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/gu, " ");
}

function visibleExact(value: string): string {
    return value.replaceAll("\\", "\\\\");
}

function assertTerminalHealth(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(30);
    expect(snapshot.scroll.visibleRows).toBe(30);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
    expect(snapshot.cursor.x).toBeLessThan(100);
    expect(snapshot.cursor.y).toBeLessThan(30);
}
