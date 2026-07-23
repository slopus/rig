import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Codex encrypted collaboration", () => {
    it("delivers spawn_agent ciphertext through the child agent envelope", async () => {
        const ciphertext = "opaque-native-spawn-ciphertext";
        let parentSessionId: string | undefined;
        let childReceivedEncryptedMessage = false;
        const gym = await createGym({
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
                    return { content: [{ text: "Encrypted delegation", type: "text" }] };
                }
                parentSessionId ??= sessionId;

                if (sessionId !== parentSessionId) {
                    const encryptedMessage = request.context.messages
                        .filter((message) => message.role === "user")
                        .at(-1)?.encryptedAgentMessage;
                    expect(encryptedMessage?.encryptedContent).toBe(ciphertext);
                    expect(encryptedMessage?.header).toContain("Message Type: NEW_TASK");
                    expect(
                        request.context.messages.some((message) =>
                            contentContainsText(message.content, ciphertext),
                        ),
                    ).toBe(false);
                    childReceivedEncryptedMessage = true;
                    return { content: [{ text: "ENCRYPTED_CHILD_DONE", type: "text" }] };
                }

                const last = JSON.stringify(request.context.messages.at(-1));
                if (last.includes("Delegate an encrypted audit.")) {
                    return {
                        content: [
                            {
                                arguments: {
                                    fork_turns: "none",
                                    message: ciphertext,
                                    task_name: "encrypted_audit",
                                },
                                id: "spawn-encrypted-audit",
                                name: "spawn_agent",
                                namespace: "collaboration",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                if (last.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_SAW_ENCRYPTED_CHILD", type: "text" }] };
                }
                return { content: [{ text: "PARENT_STARTED_ENCRYPTED_CHILD", type: "text" }] };
            },
            modelId: "openai/gpt-5.6-sol",
            providerId: "codex",
            providerOverrides: ["codex"],
            rows: 24,
        });
        running.add(gym);

        gym.terminal.type("Delegate an encrypted audit.");
        gym.terminal.press("enter");

        const result = await gym.terminal.waitUntil(
            (snapshot) =>
                childReceivedEncryptedMessage &&
                snapshot.text.includes('"Encrypted audit" completed in'),
            "the encrypted task to reach the child and complete",
            30_000,
        );
        expect(result.text).not.toContain("Invalid arguments");
        expect(result.text).not.toContain("Tool 'collaboration.spawn_agent' failed");
    }, 60_000);
});

function contentContainsText(content: unknown, expected: string): boolean {
    if (typeof content === "string") return content.includes(expected);
    if (!Array.isArray(content)) return false;
    return content.some(
        (block) =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string" &&
            block.text.includes(expected),
    );
}
