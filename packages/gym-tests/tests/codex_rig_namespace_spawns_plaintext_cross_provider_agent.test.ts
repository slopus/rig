import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Codex Rig namespace cross-provider delegation", () => {
    it("uses rig.spawn_agent for a plaintext Claude child", async () => {
        let parentSessionId: string | undefined;
        let childReceivedPlaintext = false;
        const gym = await createGym({
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            homeFiles: {
                ".codex/auth.json": JSON.stringify({
                    auth_mode: "chatgpt",
                    tokens: {
                        access_token: "gym-codex-token",
                        account_id: "gym-account",
                    },
                }),
            },
            inference(request) {
                const sessionId = request.options.sessionId;
                if (sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Rig namespace", type: "text" }] };
                }
                if (request.providerId === "claude") {
                    expect(request.modelId).toBe("anthropic/fable-5");
                    expect(JSON.stringify(request.context.messages)).toContain(
                        "PLAIN_CROSS_PROVIDER_TASK",
                    );
                    expect(JSON.stringify(request.context.messages)).not.toContain("gAAAA");
                    childReceivedPlaintext = true;
                    return { content: [{ text: "RIG_CHILD_DONE", type: "text" }] };
                }

                expect(request.providerId).toBe("codex");
                parentSessionId ??= sessionId;
                expect(sessionId).toBe(parentSessionId);
                const last = JSON.stringify(request.context.messages.at(-1));
                if (last.includes("Delegate through the portable namespace")) {
                    expect(request.context.systemPrompt).toContain("`rig` is provider-neutral");
                    return {
                        content: [
                            {
                                arguments: {
                                    context: "task",
                                    effort: "medium",
                                    message: "PLAIN_CROSS_PROVIDER_TASK",
                                    model: "anthropic/fable-5",
                                    provider: "claude",
                                    task_name: "portable_child",
                                },
                                id: "rig-cross-provider-spawn",
                                name: "spawn_agent",
                                namespace: "rig",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (last.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_RIG_CROSS_PROVIDER_OK", type: "text" }] };
                }
                return { content: [{ text: "PARENT_STARTED_RIG_CHILD", type: "text" }] };
            },
            modelId: "openai/gpt-5.6-sol",
            mode: "docker",
            providerId: "codex",
            providerOverrides: ["codex", "claude"],
            rows: 28,
        });
        running.add(gym);

        gym.terminal.type("Delegate through the portable namespace.");
        gym.terminal.press("enter");

        const result = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_STARTED_RIG_CHILD") && childReceivedPlaintext,
            "the Rig child to receive plaintext and the parent to continue",
            30_000,
        );
        expect(result.text).not.toContain("Tool 'rig.spawn_agent' failed");
        expect(childReceivedPlaintext).toBe(true);
    }, 120_000);
});
