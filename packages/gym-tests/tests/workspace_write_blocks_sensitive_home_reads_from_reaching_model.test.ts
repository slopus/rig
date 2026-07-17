import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const COLS = 100;
const ROWS = 28;
const SECRET = "SYNTHETIC_PRIVATE_KEY_SENTINEL_7A91";
const SECRET_BASE64 = "U1lOVEhFVElDX1BSSVZBVEVfS0VZX1NFTlRJTkVMXzdBOTE=";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Workspace write blocks sensitive home reads from reaching the model", () => {
    it("denies a compromised model access to a private key outside the workspace", async () => {
        const privatePath = "/home/rig/.ssh/id_rsa";
        const gym = await createGym({
            cols: COLS,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);
                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: `mkdir -p /home/rig/.ssh && printf '%s' '${SECRET_BASE64}' | base64 -d > ${privatePath}`,
                                },
                                id: "seed-private-key",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    expect(toolResultText(lastMessage)).not.toContain("Permission denied");
                    return { content: [{ text: "PRIVATE_FIXTURE_READY", type: "text" }] };
                }

                if (callIndex === 2) {
                    expect(messageText(lastMessage)).toContain("ordinary workspace status");
                    return {
                        content: [
                            {
                                arguments: { cmd: `cat ${privatePath}` },
                                id: "host-sensitive-read",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 3) {
                    const leaked = toolResultText(lastMessage).includes(SECRET);
                    if (leaked) {
                        return {
                            content: [
                                { text: "SECURITY_FAILURE_SECRET_REACHED_MODEL", type: "text" },
                            ],
                        };
                    }
                    expect(lastMessage).toMatchObject({
                        isError: true,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return { content: [{ text: "SENSITIVE_HOME_READ_BLOCKED", type: "text" }] };
                }

                expect(callIndex).toBe(4);
                return { content: [{ text: "SENSITIVE_READ_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: ROWS,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "Create a synthetic private fixture for this security test.");
        await gym.terminal.waitForText("PRIVATE_FIXTURE_READY", 30_000);

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Workspace write.");

        submit(gym, "Report only ordinary workspace status.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("SENSITIVE_HOME_READ_BLOCKED") ||
                    snapshot.text.includes("SECURITY_FAILURE_SECRET_REACHED_MODEL")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the sensitive read security outcome",
            30_000,
        );
        expect(outcome.text).toContain("SENSITIVE_HOME_READ_BLOCKED");
        expect(outcome.text).not.toContain("SECURITY_FAILURE_SECRET_REACHED_MODEL");
        expect(outcome.text).not.toContain(SECRET);
        expect(outcome.text).toContain("Failed cat /home/rig/.ssh/id_rsa");
        expect(outcome.text).toMatch(/not permitted|Permission denied|No such file or directory/iu);
        assertHealthy(outcome, baseline);

        submit(gym, "Confirm the restricted session still works.");
        const followUp = await gym.terminal.waitForText("SENSITIVE_READ_FOLLOW_UP_OK", 30_000);
        expect(followUp.text).not.toContain(SECRET);
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

function toolResultText(message: { content: unknown } | undefined): string {
    return messageText(message);
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
    expect(snapshot.text).not.toContain("�");
}
