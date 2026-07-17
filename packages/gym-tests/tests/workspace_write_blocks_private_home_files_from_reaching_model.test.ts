import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 100;
const ROWS = 28;
const PRIVATE_NOTE = "SYNTHETIC_PRIVATE_DOCUMENT_SENTINEL_C84E";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Workspace write blocks private home files from reaching the model", () => {
    it("keeps an ordinary Documents file private from a compromised model", async () => {
        let stage = 0;
        const gym = await createGym({
            cols: COLS,
            homeFiles: {
                "Documents/private-note.txt": PRIVATE_NOTE,
            },
            inference(request) {
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Private home audit", type: "text" }] };
                }

                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    return {
                        content: [
                            {
                                arguments: { cmd: "cat /home/rig/Documents/private-note.txt" },
                                id: "read-private-document",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (stage === 1) {
                    stage = 2;
                    const leaked = messageText(lastMessage).includes(PRIVATE_NOTE);
                    if (leaked) {
                        return {
                            content: [
                                {
                                    text: "SECURITY_FAILURE_PRIVATE_DOCUMENT_REACHED_MODEL",
                                    type: "text",
                                },
                            ],
                        };
                    }
                    expect(lastMessage).toMatchObject({
                        isError: true,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return { content: [{ text: "PRIVATE_HOME_READ_BLOCKED", type: "text" }] };
                }

                return { content: [{ text: "PRIVATE_HOME_FOLLOW_UP_OK", type: "text" }] };
            },
            permissionMode: "workspace_write",
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Inspect only public information about this project.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("PRIVATE_HOME_READ_BLOCKED") ||
                    snapshot.text.includes("SECURITY_FAILURE_PRIVATE_DOCUMENT_REACHED_MODEL")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the private home read security outcome",
            30_000,
        );
        expect(outcome.text).toContain("PRIVATE_HOME_READ_BLOCKED");
        expect(outcome.text).not.toContain("SECURITY_FAILURE_PRIVATE_DOCUMENT_REACHED_MODEL");
        expect(outcome.text).not.toContain(PRIVATE_NOTE);
        expect(outcome.text).toContain("Failed cat /home/rig/Documents/private-note.txt");
        expect(outcome.text).toMatch(
            /not permitted|Permission denied|No such file or directory|private files/iu,
        );
        assertHealthy(outcome, baseline);

        submit(gym, "Confirm the restricted session remains usable.");
        const followUp = await gym.terminal.waitForText("PRIVATE_HOME_FOLLOW_UP_OK", 30_000);
        expect(followUp.text).not.toContain(PRIVATE_NOTE);
        assertHealthy(followUp, baseline);
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
    expect(snapshot.scroll.visibleRows).toBe(ROWS);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(COLS);
    expect(snapshot.cursor.y).toBeLessThan(ROWS);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).toContain("workspace write");
    expect(snapshot.text).not.toContain("�");
}
