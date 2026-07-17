import { afterEach, describe, expect, it } from "vitest";

import { captureScrollback, createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("concurrent Auto approvals keep the remaining request waiting", () => {
    it("does not imply all machine work is running after only the first command is allowed", async () => {
        const alphaCommand = "printf 'alpha approved\\n' > alpha-approved.txt";
        const betaCommand = "printf 'beta approved\\n' > beta-approved.txt";
        const history = [
            "APPROVAL_HISTORY_BEGIN",
            ...Array.from(
                { length: 110 },
                (_, index) => `APPROVAL_HISTORY_${String(index).padStart(3, "0")} stable row`,
            ),
            "APPROVAL_HISTORY_END",
        ].join("\n");
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
                            delayMs: 300,
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
                    return { content: [{ text: history, type: "text" }] };
                }

                if (callIndex === 1) {
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

                if (callIndex === 4) {
                    const results = request.context.messages.filter(
                        (message) => message.role === "toolResult",
                    );
                    expect(results).toHaveLength(2);
                    expect(results.every((message) => message.isError === false)).toBe(true);
                    return {
                        content: [{ text: "BOTH_APPROVED_COMMANDS_FINISHED", type: "text" }],
                    };
                }

                expect(callIndex).toBe(5);
                expect(messageText(lastMessage)).toContain("Confirm approval handling recovered");
                return {
                    content: [{ text: "CONCURRENT_APPROVAL_FOLLOW_UP_OK", type: "text" }],
                };
            },
            rows: 36,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Create approval history.");
        await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("APPROVAL_HISTORY_END") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "approval history at the bottom",
            30_000,
        );

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Auto.");

        const output: string[] = [];
        const stopOutputCapture = gym.terminal.onOutput((data) => output.push(data));
        submit(gym, "Run both proof actions, but ask me about each command before it runs.");
        await gym.terminal.waitForText("esc to interrupt", 30_000);
        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(46);
        const anchored = await gym.terminal.snapshot();
        expect(anchored.scroll.atTop).toBe(false);
        expect(anchored.scroll.atBottom).toBe(false);
        expect(anchored.text).toContain("APPROVAL_HISTORY_");
        const anchorMarker = /APPROVAL_HISTORY_\d{3}/u.exec(anchored.text)?.[0];
        expect(anchorMarker).toBeDefined();
        if (anchorMarker === undefined) throw new Error("Approval anchor marker was not visible.");
        let bothReviewsStartedAt: number | undefined;
        await gym.terminal.waitUntil(
            () => {
                if (agentRequestCount(gym) < 4) return false;
                bothReviewsStartedAt ??= Date.now();
                return Date.now() - bothReviewsStartedAt >= 800;
            },
            "both delayed reviews to settle while history remains visible",
            30_000,
        );
        const reviewWhileAnchored = await gym.terminal.snapshot();
        assertSameViewport(reviewWhileAnchored, anchored);

        gym.terminal.scrollToBottom();
        const bothPending = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Alpha still needs your explicit approval.") &&
                snapshot.text.includes("• Awaiting approval printf 'alpha approved") &&
                snapshot.text.includes("• Awaiting approval printf 'beta approved") &&
                normalizeWhitespace(snapshot.text).includes(
                    `Allow running "${visibleExact(alphaCommand)}". Working directory: "/workspace". Shell: "the default shell". Access: unrestricted filesystem and network access? · 1 of 1`,
                ) &&
                snapshot.text.includes("◦ Waiting for approval") &&
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
        assertTerminalHealth(bothPending, baseline, 1);

        const betaReplacement = waitForTerminalOutput(
            gym,
            "Beta still needs your explicit approval.",
            30_000,
        );
        gym.terminal.press("enter");
        gym.terminal.scrollToTop();
        gym.terminal.scrollBy(46);
        await betaReplacement;
        const betaWhileAnchored = await gym.terminal.snapshot();
        assertSameViewport(betaWhileAnchored, anchored, 1);

        gym.terminal.scrollToBottom();
        const betaStillPending = await gym.terminal.waitUntil(
            (snapshot) =>
                normalizeWhitespace(snapshot.text).includes(
                    `Allow running "${visibleExact(betaCommand)}". Working directory: "/workspace". Shell: "the default shell". Access: unrestricted filesystem and network access? · 1 of 1`,
                ) &&
                snapshot.text.includes("• Ran printf 'alpha approved") &&
                snapshot.text.includes("• Awaiting approval printf 'beta approved") &&
                snapshot.scroll.atBottom,
            "the beta prompt remaining after alpha finishes",
            30_000,
        );
        expect(betaStillPending.text).toContain("◦ Waiting for approval");
        expect(betaStillPending.text).not.toContain("• Running 1 tool");
        expect(betaStillPending.text).not.toContain("• Running printf 'beta approved");
        await expect(gym.readFile("alpha-approved.txt")).resolves.toBe("alpha approved\n");
        await expect(gym.readFile("beta-approved.txt")).rejects.toMatchObject({ code: "ENOENT" });
        assertTerminalHealth(betaStillPending, baseline, 2);

        const completedOutput = waitForTerminalOutput(
            gym,
            "BOTH_APPROVED_COMMANDS_FINISHED",
            30_000,
        );
        gym.terminal.press("enter");
        await completedOutput;
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("BOTH_APPROVED_COMMANDS_FINISHED") &&
                snapshot.text.includes("• Ran printf 'beta approved") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.text.includes("gym off") &&
                snapshot.scroll.atBottom,
            "both approved commands completed",
            30_000,
        );
        expect(completed.text).not.toContain("◦ Waiting for approval");
        expect(completed.text).not.toContain("• Running 1 tool");
        expect(completed.text).not.toContain("concurrent-alpha-approval");
        expect(completed.text).not.toContain("concurrent-beta-approval");
        expect(completed.text).not.toContain("exec_command");
        await expect(gym.readFile("beta-approved.txt")).resolves.toBe("beta approved\n");
        assertTerminalHealth(completed, baseline, 2);
        expect(output.join("")).not.toContain("\x1b[3J");
        expect(output.join("")).not.toContain("\x1b[2J\x1b[H");
        stopOutputCapture();

        submit(gym, "Confirm approval handling recovered normally.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CONCURRENT_APPROVAL_FOLLOW_UP_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy follow-up after concurrent approvals",
            30_000,
        );
        assertTerminalHealth(followUp, baseline, 2);

        const scrollback = await captureScrollback(gym);
        expect(countOccurrences(scrollback, anchorMarker)).toBe(1);
        expect(countOccurrences(scrollback, "BOTH_APPROVED_COMMANDS_FINISHED")).toBe(1);
        expect(countOccurrences(scrollback, "CONCURRENT_APPROVAL_FOLLOW_UP_OK")).toBe(1);
        expect(maximumBlankRun(scrollback)).toBeLessThanOrEqual(4);
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

function visibleExact(value: string): string {
    return value.replaceAll("\\", "\\\\");
}

function assertTerminalHealth(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
    transitionDelta = 0,
): void {
    expect(snapshot.rows).toHaveLength(36);
    expect(snapshot.scroll.visibleRows).toBe(36);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(
        baseline.bottomDepartureCount + transitionDelta,
    );
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount + transitionDelta);
    expect(snapshot.cursor.x).toBeLessThan(110);
    expect(snapshot.cursor.y).toBeLessThan(36);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
}

function assertSameViewport(
    actual: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    expected: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    transitionDelta = 0,
): void {
    expect(actual.rows).toEqual(expected.rows);
    expect(actual.text).toBe(expected.text);
    expect(actual.scroll.offset).toBe(expected.scroll.offset);
    expect(actual.scroll.bottomDepartureCount).toBe(
        expected.scroll.bottomDepartureCount + transitionDelta,
    );
    expect(actual.scroll.topArrivalCount).toBe(expected.scroll.topArrivalCount + transitionDelta);
}

function waitForTerminalOutput(gym: Gym, text: string, timeoutMs: number): Promise<void> {
    return new Promise((resolvePromise, reject) => {
        let output = "";
        const expected = normalizeTerminalOutput(text);
        const stop = gym.terminal.onOutput((data) => {
            output += data;
            if (!normalizeTerminalOutput(output).includes(expected)) return;
            clearTimeout(timer);
            stop();
            resolvePromise();
        });
        const timer = setTimeout(() => {
            stop();
            reject(new Error(`Timed out waiting for terminal output ${JSON.stringify(text)}.`));
        }, timeoutMs);
    });
}

function normalizeTerminalOutput(value: string): string {
    const ansiCsiPattern = new RegExp(`${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");
    return value.replace(ansiCsiPattern, "").replace(/\s+/gu, " ");
}

function countOccurrences(value: string, search: string): number {
    return value.split(search).length - 1;
}

function maximumBlankRun(value: string): number {
    let maximum = 0;
    let current = 0;
    for (const row of value.split("\n")) {
        current = row.trim().length === 0 ? current + 1 : 0;
        maximum = Math.max(maximum, current);
    }
    return maximum;
}

function agentRequestCount(gym: Gym): number {
    return gym.inference.requests.filter(
        (request) => !request.options.sessionId?.endsWith(":title"),
    ).length;
}
