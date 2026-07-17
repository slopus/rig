import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("shell tools do not inherit inference credentials", () => {
    it("keeps the provider token and its presence out of the next model request", async () => {
        const leakMarker = "INFERENCE_CREDENTIAL_REACHED_UNTRUSTED_SHELL";
        const absentMarker = "INFERENCE_CREDENTIAL_NOT_IN_SHELL_ENVIRONMENT";
        let inferenceToken = "";
        let nextRequestContainedCredential = false;
        let nextRequestContainedLeakMarker = false;
        const gym = await createGym({
            cols: 100,
            inference(request, callIndex) {
                const lastMessage = request.context.messages.at(-1);

                if (callIndex === 0) {
                    expect(lastMessage).toMatchObject({ role: "user" });
                    return {
                        content: [
                            {
                                arguments: {
                                    cmd: [
                                        "credential_found=0",
                                        '[ -n "${RIG_GYM_TOKEN:-}" ] && credential_found=1',
                                        "if [ \"$credential_found\" -eq 1 ]; then printf 'INFERENCE_CREDENTIAL_REACHED_%s\\n' 'UNTRUSTED_SHELL'; else printf 'INFERENCE_CREDENTIAL_NOT_IN_%s\\n' 'SHELL_ENVIRONMENT'; fi",
                                    ].join("; "),
                                    workdir: "/workspace",
                                },
                                id: "compromised-model-probes-provider-secret",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                if (callIndex === 1) {
                    const serializedRequest = JSON.stringify(request);
                    nextRequestContainedCredential = serializedRequest.includes(inferenceToken);
                    nextRequestContainedLeakMarker = serializedRequest.includes(leakMarker);
                    expect(lastMessage).toMatchObject({
                        isError: false,
                        role: "toolResult",
                        toolName: "exec_command",
                    });
                    expect(messageText(lastMessage)).toContain(absentMarker);
                    return {
                        content: [
                            {
                                text:
                                    nextRequestContainedCredential || nextRequestContainedLeakMarker
                                        ? "SHELL_INHERITED_PROVIDER_CREDENTIAL"
                                        : "SHELL_CREDENTIAL_ENV_ISOLATED",
                                type: "text",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(lastMessage).toMatchObject({ role: "user" });
                return {
                    content: [{ text: "CREDENTIAL_ISOLATION_FOLLOW_UP_COMPLETE", type: "text" }],
                };
            },
            rows: 30,
        });
        running.add(gym);
        inferenceToken = gym.inference.token;
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

        submit(gym, "Check whether the shell can access the provider credential.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                (snapshot.text.includes("SHELL_CREDENTIAL_ENV_ISOLATED") ||
                    snapshot.text.includes("SHELL_INHERITED_PROVIDER_CREDENTIAL")) &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "provider credential isolation result",
            30_000,
        );

        expect.soft(nextRequestContainedCredential).toBe(false);
        expect.soft(nextRequestContainedLeakMarker).toBe(false);
        expect.soft(completed.text).toContain("SHELL_CREDENTIAL_ENV_ISOLATED");
        expect.soft(completed.text).not.toContain("SHELL_INHERITED_PROVIDER_CREDENTIAL");
        expect.soft(completed.text).not.toContain(leakMarker);
        expect(completed.text.includes(inferenceToken)).toBe(false);
        expect(completed.text).toContain("RIG_GYM_TOKEN");
        expect(completed.text).not.toContain("compromised-model-probes-provider-secret");
        expect(footerRow(completed)).toContain("workspace write");
        assertHealthyTerminal(completed, baseline);

        submit(gym, "Confirm normal operation after the credential probe.");
        const followUp = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("CREDENTIAL_ISOLATION_FOLLOW_UP_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "follow-up after credential probe",
            30_000,
        );
        expect(followUp.text.includes(inferenceToken)).toBe(false);
        expect(footerRow(followUp)).toContain("workspace write");
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
    expect(snapshot.rows).toHaveLength(30);
    expect(snapshot.scroll.visibleRows).toBe(30);
    expect(snapshot.scroll.atBottom).toBe(true);
    expect(snapshot.scroll.bottomDepartureCount).toBe(baseline.bottomDepartureCount);
    expect(snapshot.scroll.topArrivalCount).toBe(baseline.topArrivalCount);
    expect(snapshot.cursor.x).toBeLessThan(100);
    expect(snapshot.cursor.y).toBeLessThan(30);
    expect(snapshot.text).toContain("gym off");
    expect(snapshot.text).toContain("/workspace");
    expect(snapshot.text).not.toContain("\x1b");
    expect(snapshot.text).not.toContain("�");
}
