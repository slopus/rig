import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Claude WebFetch approval after an invalid Auto review", () => {
    it("shows an answerable approval prompt and drains queued input after interruption", async () => {
        const gym = await createGym({
            environment: { ANTHROPIC_API_KEY: "claude-test-key" },
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    expect(callIndex).toBe(1);
                    return {
                        content: [{ text: "not a permission decision", type: "text" }],
                    };
                }

                if (callIndex === 0) {
                    return {
                        content: [
                            {
                                arguments: {
                                    prompt: "Summarize this page.",
                                    url: "https://example.com",
                                },
                                id: "claude-web-fetch-invalid-review",
                                name: "WebFetch",
                                type: "toolCall",
                            },
                        ],
                    };
                }

                expect(callIndex).toBe(2);
                expect(messageText(request.context.messages.at(-1))).toContain(
                    "Continue after the interrupted approval.",
                );
                return {
                    content: [{ text: "QUEUE_DRAINED_AFTER_APPROVAL_INTERRUPT", type: "text" }],
                };
            },
            modelId: "anthropic/opus-4-8",
            permissionMode: "auto",
            providerId: "claude",
            providerOverrides: ["claude"],
        });
        running.add(gym);

        submit(gym, "Fetch example.com, but rely on Auto permissions.");
        const approval = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes(
                    "The automatic permission review returned an invalid decision.",
                ) &&
                snapshot.text.includes("Allow once") &&
                snapshot.text.includes("Deny") &&
                snapshot.text.includes("Waiting for approval"),
            "the Claude WebFetch approval prompt",
            30_000,
        );
        expect(approval.text).toContain("Permission");
        expect(approval.text).toContain("https://example.com");

        gym.terminal.press("escape");
        await gym.terminal.waitUntil(
            (snapshot) => snapshot.text.includes("Session interrupted"),
            "the interrupted approval",
            30_000,
        );

        submit(gym, "Continue after the interrupted approval.");
        const continued = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("QUEUE_DRAINED_AFTER_APPROVAL_INTERRUPT") &&
                snapshot.text.includes("Ask Rig to do anything"),
            "the queued follow-up after approval interruption",
            30_000,
        );
        expect(continued.text).not.toContain("queued 1");
    }, 90_000);
});

function messageText(message: { content: unknown } | undefined): string {
    if (typeof message?.content === "string") return message.content;
    if (!Array.isArray(message?.content)) return "";
    return message.content
        .filter(
            (block): block is { text: string } =>
                typeof block === "object" &&
                block !== null &&
                "text" in block &&
                typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("\n");
}

function submit(gym: Gym, text: string): void {
    gym.terminal.type(text);
    gym.terminal.press("enter");
}
