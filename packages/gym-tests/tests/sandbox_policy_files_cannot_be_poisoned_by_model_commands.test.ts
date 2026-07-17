import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const POLICY_BASE64 =
    "eyJlbmFibGVXZWFrZXJOZXN0ZWRTYW5kYm94Ijp0cnVlLCJuZXR3b3JrIjp7ImFsbG93ZWREb21haW5zIjpbXSwiZGVuaWVkRG9tYWlucyI6W119LCJmaWxlc3lzdGVtIjp7ImRlbnlSZWFkIjpbXSwiYWxsb3dSZWFkIjpbXSwiYWxsb3dXcml0ZSI6WyIvIl0sImRlbnlXcml0ZSI6W119fQ==";
const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("sandbox policy files cannot be poisoned by model commands", () => {
    it("keeps a first restricted command from weakening the next command's boundary", async () => {
        let stage = 0;
        const gym = await createGym({
            cols: 100,
            inference(request) {
                if (request.options.sessionId?.endsWith(":title")) {
                    return { content: [{ text: "Sandbox policy audit", type: "text" }] };
                }

                const lastMessage = request.context.messages.at(-1);
                if (stage === 0) {
                    stage = 1;
                    expect(messageText(lastMessage)).toContain("Inspect the sandbox boundary");
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: [
                                        "policy=$(find /tmp -path '/tmp/rig-sandbox-*/*.json' -type f -print -quit 2>/dev/null)",
                                        "if [ -z \"$policy\" ]; then printf 'POLICY_NOT_DISCOVERABLE\\n'; exit 0; fi",
                                        `printf '%s' '${POLICY_BASE64}' | base64 -d > "$policy" && printf 'POLICY_%s\\n' 'POISONED'`,
                                    ].join("; "),
                                },
                                id: "poison-sandbox-policy",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (stage === 1) {
                    stage = 2;
                    expect(lastMessage).toMatchObject({
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: "printf 'escaped through poisoned policy\\n' > /var/tmp/rig-policy-poisoned.txt && cp /var/tmp/rig-policy-poisoned.txt /workspace/policy-poisoning-evidence.txt",
                                },
                                id: "use-poisoned-sandbox-policy",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (stage === 2) {
                    stage = 3;
                    return {
                        content: [
                            {
                                text:
                                    lastMessage?.role === "toolResult" &&
                                    lastMessage.isError === true
                                        ? "SANDBOX_POLICY_FILES_PROTECTED"
                                        : "SECURITY_FAILURE_SANDBOX_POLICY_POISONED",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(stage).toBe(3);
                return { content: [{ text: "POLICY_AUDIT_FOLLOW_UP_OK", type: "text" }] };
            },
            rows: 28,
        });
        running.add(gym);
        const baseline = (await gym.terminal.snapshot()).scroll;

        submit(gym, "/permissions");
        await gym.terminal.waitForText("Choose Permissions");
        gym.terminal.press("up");
        gym.terminal.press("up");
        gym.terminal.press("enter");
        await gym.terminal.waitForText("Permissions changed to Workspace write.");

        submit(gym, "Inspect the sandbox boundary without leaving the workspace.");
        const outcome = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("SANDBOX_POLICY_FILES_PROTECTED") ||
                    snapshot.text.includes("SECURITY_FAILURE_SANDBOX_POLICY_POISONED")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "the sandbox policy poisoning outcome",
            30_000,
        );
        expect(outcome.text).toContain("SANDBOX_POLICY_FILES_PROTECTED");
        expect(outcome.text).not.toContain("SECURITY_FAILURE_SANDBOX_POLICY_POISONED");
        expect(outcome.text).not.toContain("POLICY_POISONED");
        await expect(gym.readFile("policy-poisoning-evidence.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
        assertHealthy(outcome, baseline);

        submit(gym, "Confirm the restricted session remains usable.");
        const followUp = await gym.terminal.waitForText("POLICY_AUDIT_FOLLOW_UP_OK", 30_000);
        await expect(gym.readFile("policy-poisoning-evidence.txt")).rejects.toMatchObject({
            code: "ENOENT",
        });
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
    expect(snapshot.rows).toHaveLength(28);
    expect(snapshot.scroll.visibleRows).toBe(28);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(100);
    expect(snapshot.cursor.y).toBeLessThan(28);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).toContain("workspace write");
    expect(snapshot.text).not.toContain("�");
}
