import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("escalated approval discloses the complete execution boundary", () => {
    it("shows the exact command, directory, shell, and unrestricted scope before denial", async () => {
        const command =
            "printf 'outside workspace\\n' > /home/rig/disclosure-denied.txt; printf 'ran\\n' > /workspace/disclosure-action-ran.txt";
        const gym = await createGym({
            cols: 112,
            inference(request, callIndex) {
                const systemPrompt = request.context.systemPrompt ?? "";
                const lastMessage = request.context.messages.at(-1);

                if (systemPrompt.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "ask",
                                    risk: "high",
                                    user_authorization: "low",
                                    reason: "This action requests unrestricted execution outside the workspace.",
                                }),
                                type: "text",
                            },
                        ],
                    };
                }

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: command,
                                    justification:
                                        "Use a custom shell and operate outside the workspace sandbox.",
                                    sandbox_permissions: "require_escalated",
                                    shell: "/bin/sh",
                                    workdir: "/home/rig",
                                },
                                id: "opaque-escalation-call-7f3c1a",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({
                        isError: true,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [{ text: "COMPLETE_BOUNDARY_ACTION_DENIED", type: "text" }],
                    };
                }

                expect(callIndex).toBe(3);
                expect(messageText(lastMessage)).toContain(
                    "Confirm the denied action changed nothing",
                );
                return {
                    content: [{ text: "BOUNDARY_DISCLOSURE_FOLLOW_UP_OK", type: "text" }],
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

        submit(
            gym,
            "Show every security-relevant detail and ask before running the proposed action.",
        );
        const approval = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("Deny") &&
                snapshot.text.includes("/home/rig") &&
                snapshot.scroll.atBottom,
            "the approval panel with the full execution boundary",
            30_000,
        );
        const normalizedApproval = normalizeWhitespace(approval.text);
        expect(normalizedApproval).toContain(visibleExact(command));
        expect(normalizedApproval).toContain('Working directory: "/home/rig"');
        expect(normalizedApproval).toContain('Shell: "/bin/sh"');
        expect(normalizedApproval.toLowerCase()).toMatch(
            /unrestricted (?:file system|filesystem) and network access/u,
        );
        expect(approval.text).toContain("Awaiting approval");
        expect(approval.text).toContain("Waiting for approval");
        expect(approval.text).not.toContain("opaque-escalation-call-7f3c1a");
        expect(approval.text).not.toContain("exec_command");
        expect(approval.text).not.toContain("sandbox_permissions");
        expect(approval.text).not.toContain("require_escalated");
        await expect(gym.readFile("disclosure-action-ran.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        assertTerminalHealth(approval, baseline);

        gym.terminal.press("down");
        gym.terminal.press("enter");
        const denied = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("COMPLETE_BOUNDARY_ACTION_DENIED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the safely denied action and recovered composer",
            30_000,
        );
        expect(denied.text).toContain("Auto mode did not approve running");
        expect(denied.text).not.toContain("opaque-escalation-call-7f3c1a");
        await expect(gym.readFile("disclosure-action-ran.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        assertTerminalHealth(denied, baseline);

        submit(gym, "Confirm the denied action changed nothing and normal control returned.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("BOUNDARY_DISCLOSURE_FOLLOW_UP_OK") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "a healthy follow-up after denying escalation",
            30_000,
        );
        assertTerminalHealth(followUp, baseline);
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
    expect(snapshot.rows).toHaveLength(36);
    expect(snapshot.scroll.visibleRows).toBe(36);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("�");
    expect(snapshot.cursor.x).toBeLessThan(112);
    expect(snapshot.cursor.y).toBeLessThan(36);
}
