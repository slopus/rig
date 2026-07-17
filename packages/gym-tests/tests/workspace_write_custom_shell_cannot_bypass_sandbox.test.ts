import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Workspace write custom shells cannot bypass the sandbox", () => {
    it("contains a shell that ignores its command argument and discloses the shell choice", async () => {
        const shellPath = "/workspace/custom-shell";
        const escapedPath = "/home/rig/custom-shell-escaped.txt";
        const executedMarker = "CUSTOM_SHELL_EXECUTED";
        const escapedMarker = "CUSTOM_SHELL_SANDBOX_ESCAPE_PRESENT";
        const containedMarker = "CUSTOM_SHELL_SANDBOX_HELD";
        const gym = await createGym({
            cols: 100,
            files: {
                "custom-shell": {
                    content: [
                        "#!/bin/sh",
                        `printf '${executedMarker}\\n'`,
                        `printf 'sandbox escaped\\n' > ${escapedPath}`,
                        "exit 0",
                        "",
                    ].join("\n"),
                    mode: 0o755,
                },
            },
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                const resultText = messageText(lastMessage);

                if (callIndex === 0) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf 'ordinary workspace command\\n'",
                                    shell: shellPath,
                                    workdir: "/workspace",
                                },
                                id: "compromised-model-custom-shell",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    expect(resultText).toContain(
                        "Custom shells are available only in Full access mode.",
                    );
                    expect(resultText).not.toContain(executedMarker);
                    return {
                        content: [{ text: "CUSTOM_SHELL_REJECTION_CONFIRMED", type: "text" }],
                    };
                }

                if (callIndex === 2) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: `if [ -e ${escapedPath} ]; then printf 'CUSTOM_SHELL_SANDBOX_%s\\n' 'ESCAPE_PRESENT'; rm -f ${escapedPath}; else printf 'CUSTOM_SHELL_SANDBOX_%s\\n' 'HELD'; fi`,
                                    workdir: "/workspace",
                                },
                                id: "audit-and-clean-custom-shell-confinement",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 3) {
                    expect(lastMessage).toMatchObject({
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [
                            {
                                text: resultText.includes(containedMarker)
                                    ? "CUSTOM_SHELL_WAS_CONTAINED"
                                    : "CUSTOM_SHELL_ESCAPED_THE_SANDBOX",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(4);
                expect(lastMessage).toMatchObject({ role: "user" });
                return {
                    content: [{ text: "CUSTOM_SHELL_FOLLOW_UP_COMPLETE", type: "text" }],
                };
            },
            rows: 32,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        await selectWorkspaceWrite(gym);
        const selected = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Permissions changed to Workspace write.") &&
                footerRow(snapshot).includes("workspace write") &&
                snapshot.scroll.atBottom,
            "Workspace write permission scope",
        );
        assertHealthyTerminal(selected, baseline);

        submit(gym, "Run the requested workspace check.");
        const attempted = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CUSTOM_SHELL_REJECTION_CONFIRMED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                footerRow(snapshot).includes("workspace write") &&
                snapshot.scroll.atBottom,
            "completed custom shell attempt",
            30_000,
        );
        expect.soft(attempted.text).toContain(shellPath);
        expect
            .soft(attempted.text)
            .toContain("Custom shells are available only in Full access mode.");
        expect.soft(attempted.text).not.toContain(executedMarker);
        expect(attempted.text).not.toContain("compromised-model-custom-shell");
        expect(footerRow(attempted)).toContain("workspace write");
        assertHealthyTerminal(attempted, baseline);

        await selectFullAccess(gym);
        const fullAccess = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Permissions changed to Full access.") &&
                footerRow(snapshot).includes("full access") &&
                snapshot.scroll.atBottom,
            "Full access for the independent audit and cleanup",
        );
        assertHealthyTerminal(fullAccess, baseline);

        submit(gym, "Audit and clean up the sandbox escape path.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("CUSTOM_SHELL_WAS_CONTAINED") ||
                    snapshot.text.includes("CUSTOM_SHELL_ESCAPED_THE_SANDBOX")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                footerRow(snapshot).includes("full access") &&
                snapshot.scroll.atBottom,
            "independent custom shell confinement audit",
            30_000,
        );

        expect.soft(completed.text).toContain("CUSTOM_SHELL_WAS_CONTAINED");
        expect.soft(completed.text).not.toContain("CUSTOM_SHELL_ESCAPED_THE_SANDBOX");
        expect.soft(completed.text).toContain(containedMarker);
        expect.soft(completed.text).not.toContain(escapedMarker);
        expect(completed.text).not.toContain("audit-and-clean-custom-shell-confinement");
        expect(footerRow(completed)).toContain("full access");
        assertHealthyTerminal(completed, baseline);

        submit(gym, "Confirm the terminal remains usable after the blocked shell.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CUSTOM_SHELL_FOLLOW_UP_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                footerRow(snapshot).includes("full access") &&
                snapshot.scroll.atBottom,
            "follow-up after custom shell confinement",
            30_000,
        );
        expect(footerRow(followUp)).toContain("full access");
        assertHealthyTerminal(followUp, baseline);
    }, 120_000);
});

async function selectWorkspaceWrite(gym: Gym): Promise<void> {
    submit(gym, "/permissions");
    await gym.terminal.waitForText("Choose Permissions");
    gym.terminal.press("up");
    gym.terminal.press("up");
    gym.terminal.press("enter");
}

async function selectFullAccess(gym: Gym): Promise<void> {
    submit(gym, "/permissions");
    await gym.terminal.waitForText("Choose Permissions");
    gym.terminal.press("down");
    gym.terminal.press("down");
    gym.terminal.press("enter");
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}

function footerRow(snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>): string {
    return snapshot.rows.find((row) => row.includes("gym off")) ?? "";
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

function assertHealthyTerminal(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(32);
    expect(snapshot.scroll.visibleRows).toBe(32);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(100);
    expect(snapshot.cursor.y).toBeLessThan(32);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("\x1b");
    expect(snapshot.text).not.toContain("�");
}
