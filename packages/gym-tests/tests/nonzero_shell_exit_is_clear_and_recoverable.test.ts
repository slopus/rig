import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 94;
const ROWS = 26;
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("nonzero shell exit is clear and recoverable", () => {
    it("marks the action failed, reports the useful cause, and keeps the next turn usable", async () => {
        const command = "printf 'permission probe blocked\\n' >&2; exit 23";
        const gym = await createGym({
            cols: COLS,
            files: { "important.txt": "keep this exactly\n" },
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: { cmd: command, workdir: "/workspace" },
                                id: "raw-shell-failure-call-id",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(lastMessage).toMatchObject({
                        isError: true,
                        role: "toolResult",
                        toolCallId: "raw-shell-failure-call-id",
                        toolName: "exec_command",
                    });
                    expect(messageText(lastMessage)).toContain("Process exited with code 23");
                    expect(messageText(lastMessage)).toContain("permission probe blocked");
                    return {
                        content: [{ text: "SHELL_FAILURE_HANDLED", type: "text" }],
                        delayMs: 500,
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({ role: "user" });
                expect(messageText(lastMessage)).toContain("Continue after the failed command");
                return { content: [{ text: "SHELL_RECOVERY_CONFIRMED", type: "text" }] };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Run the permission probe and tell me clearly if it fails.");
        const failed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("Failed printf 'permission probe blocked") &&
                snapshot.text.includes("Command exited with code 23") &&
                snapshot.text.includes("permission probe blocked") &&
                snapshot.text.includes("gym off") &&
                snapshot.scroll.atBottom,
            "failed command with its exit code and stderr",
            30_000,
        );
        expect(failed.text).not.toContain("Ran printf 'permission probe blocked");
        expect(failed.text).not.toContain("raw-shell-failure-call-id");
        expect(failed.text).not.toContain("exec_command");
        expect(failed.text).not.toContain("Tool '");
        assertHealthy(failed, baseline);
        await expect(gym.readFile("important.txt")).resolves.toBe("keep this exactly\n");
        await expect(gym.readFile("unexpected.txt")).rejects.toMatchObject({ code: "ENOENT" });

        const handled = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("SHELL_FAILURE_HANDLED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "assistant recovery after the failed command",
            30_000,
        );
        assertHealthy(handled, baseline);

        submit(gym, "Continue after the failed command.");
        const recovered = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("SHELL_RECOVERY_CONFIRMED") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up turn after the failed command",
            30_000,
        );
        expect(recovered.text).not.toContain("raw-shell-failure-call-id");
        expect(recovered.text).not.toContain("exec_command");
        assertHealthy(recovered, baseline);
        await expect(gym.readFile("important.txt")).resolves.toBe("keep this exactly\n");
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

function assertHealthy(
    snapshot: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>,
    baseline: Awaited<ReturnType<Gym["terminal"]["snapshot"]>>["scroll"],
): void {
    expect(snapshot.rows).toHaveLength(ROWS);
    expect(snapshot.rows.every((row) => [...row].length <= COLS)).toBe(true);
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.title).toContain("Rig");
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    for (const control of ["\u0000", "\u0007", "\u001b", "�"]) {
        expect(snapshot.text).not.toContain(control);
    }
}
