import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "../../packages/gym/sources/index.js";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("concurrent Auto approvals keep the remaining request waiting", () => {
    it("does not imply all machine work is running after only the first command is allowed", async () => {
        const alphaCommand = "printf 'alpha approved\\n' > alpha-approved.txt";
        const betaCommand = "printf 'beta approved\\n' > beta-approved.txt";
        const gym = await createGym({
            cols: 110,
            inference(request, callIndex) {
                const systemPrompt = request.context.systemPrompt ?? "";
                const lastMessage = request.context.messages.at(-1);

                if (systemPrompt.includes("independent permission reviewer")) {
                    const reviewText = messageText(lastMessage);
                    const proposedAction = reviewText.slice(
                        reviewText.lastIndexOf("<proposed_action>"),
                    );
                    if (proposedAction.includes("alpha-approved.txt")) {
                        return {
                            content: [
                                {
                                    text: JSON.stringify({
                                        decision: "ask",
                                        risk: "high",
                                        user_authorization: "medium",
                                        reason: "Alpha still needs your explicit approval.",
                                    }),
                                    type: "text",
                                },
                            ],
                        };
                    }

                    expect(proposedAction).toContain("beta-approved.txt");
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "ask",
                                    risk: "high",
                                    user_authorization: "medium",
                                    reason: "Beta still needs your explicit approval.",
                                }),
                                type: "text",
                            },
                        ],
                        delayMs: 500,
                    };
                }

                if (callIndex === 0) {
                    expect(messageText(lastMessage)).toContain("ask me about each command");
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: alphaCommand,
                                    justification: "Create the alpha proof only after approval.",
                                    sandbox_permissions: "require_escalated",
                                    workdir: "/workspace",
                                },
                                id: "concurrent-alpha-approval",
                                name: "exec_command",
                                type: "toolCall",
                            },
                            {
                                arguments: {
                                    cmd: betaCommand,
                                    justification: "Create the beta proof only after approval.",
                                    sandbox_permissions: "require_escalated",
                                    workdir: "/workspace",
                                },
                                id: "concurrent-beta-approval",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 3) {
                    const results = request.context.messages.filter(
                        (message) => message.role === "toolResult",
                    );
                    expect(results).toHaveLength(2);
                    expect(results.every((message) => message.isError === false)).toBe(true);
                    return {
                        content: [{ text: "BOTH_APPROVED_COMMANDS_FINISHED", type: "text" }],
                    };
                }

                expect(callIndex).toBe(4);
                expect(messageText(lastMessage)).toContain("Confirm approval handling recovered");
                return {
                    content: [{ text: "CONCURRENT_APPROVAL_FOLLOW_UP_OK", type: "text" }],
                };
            },
            rows: 36,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Auto.");

        submit(gym, "Run both proof actions, but ask me about each command before it runs.");
        const bothPending = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Alpha still needs your explicit approval.") &&
                snapshot.text.includes("Beta still needs your explicit approval.") &&
                normalizeWhitespace(snapshot.text).includes(
                    `Allow running “${alphaCommand}”? · 1 of 1`,
                ) &&
                snapshot.text.includes("• Waiting for approval") &&
                snapshot.scroll.atBottom,
            "both reviews pending while the alpha approval is open",
            30_000,
        );
        expect(bothPending.text).toContain("• Awaiting approval printf 'alpha approved");
        expect(bothPending.text).toContain("• Awaiting approval printf 'beta approved");
        expect(bothPending.text).not.toContain("• Running printf");
        expect(bothPending.text).not.toContain("concurrent-alpha-approval");
        expect(bothPending.text).not.toContain("concurrent-beta-approval");
        expect(bothPending.text).not.toContain("exec_command");
        await expect(gym.readFile("alpha-approved.txt")).rejects.toMatchObject({ code: "ENOENT" });
        await expect(gym.readFile("beta-approved.txt")).rejects.toMatchObject({ code: "ENOENT" });
        assertTerminalHealth(bothPending, baseline);

        gym.terminal.press("enter");
        const betaStillPending = await gym.terminal.waitUntil(
            (snapshot) =>
                normalizeWhitespace(snapshot.text).includes(
                    `Allow running “${betaCommand}”? · 1 of 1`,
                ) &&
                snapshot.text.includes("• Ran printf 'alpha approved") &&
                snapshot.text.includes("• Awaiting approval printf 'beta approved") &&
                snapshot.scroll.atBottom,
            "the beta prompt remaining after alpha finishes",
            30_000,
        );
        expect(betaStillPending.text).toContain("• Waiting for approval");
        expect(betaStillPending.text).not.toContain("• Running 1 tool");
        expect(betaStillPending.text).not.toContain("• Running printf 'beta approved");
        await expect(gym.readFile("alpha-approved.txt")).resolves.toBe("alpha approved\n");
        await expect(gym.readFile("beta-approved.txt")).rejects.toMatchObject({ code: "ENOENT" });
        assertTerminalHealth(betaStillPending, baseline);

        gym.terminal.press("enter");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("BOTH_APPROVED_COMMANDS_FINISHED") &&
                snapshot.text.includes("• Ran printf 'beta approved") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "both approved commands completed",
            30_000,
        );
        expect(completed.text).not.toContain("• Waiting for approval");
        expect(completed.text).not.toContain("• Running 1 tool");
        expect(completed.text).not.toContain("concurrent-alpha-approval");
        expect(completed.text).not.toContain("concurrent-beta-approval");
        expect(completed.text).not.toContain("exec_command");
        await expect(gym.readFile("beta-approved.txt")).resolves.toBe("beta approved\n");
        assertTerminalHealth(completed, baseline);

        submit(gym, "Confirm approval handling recovered normally.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CONCURRENT_APPROVAL_FOLLOW_UP_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy follow-up after concurrent approvals",
            30_000,
        );
        assertTerminalHealth(followUp, baseline);
    }, 150_000);
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
        .join("");
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/gu, " ");
}

function assertTerminalHealth(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(36);
    expect(snapshot.scroll.visibleRows).toBe(36);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(110);
    expect(snapshot.cursor.y).toBeLessThan(36);
    expect(snapshot.text).toContain("Gym Off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}
