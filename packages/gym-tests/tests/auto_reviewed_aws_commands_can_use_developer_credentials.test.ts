import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Auto-reviewed AWS commands can use developer credentials", () => {
    it("lets an approved CLI read the normal AWS profile without a second prompt", async () => {
        const gym = await createGym({
            cols: 104,
            homeFiles: {
                ".aws/credentials":
                    "[developer]\naws_access_key_id = TEST_ACCESS\naws_secret_access_key = TEST_SECRET\n",
                "bin/aws": {
                    content: [
                        "#!/bin/sh",
                        "grep -q 'aws_access_key_id = TEST_ACCESS' \"$HOME/.aws/credentials\" || exit 41",
                        "printf 'AWS_PROFILE_AVAILABLE\\n'",
                        "",
                    ].join("\n"),
                    mode: 0o755,
                },
            },
            inference(request, callIndex) {
                if (request.context.systemPrompt?.includes("independent permission reviewer")) {
                    return {
                        content: [
                            {
                                text: JSON.stringify({
                                    decision: "allow",
                                    reason: "The requested AWS identity check is routine developer work.",
                                    risk: "low",
                                    user_authorization: "high",
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
                                    cmd: "/home/rig/bin/aws sts get-caller-identity --profile developer",
                                    justification:
                                        "Use the developer credentials the user requested for this identity check.",
                                    sandbox_permissions: "require_escalated",
                                    workdir: "/workspace",
                                },
                                id: "aws-developer-identity",
                                name: "exec_command",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                expect(callIndex).toBe(2);
                expect(messageText(request.context.messages.at(-1))).toContain(
                    "AWS_PROFILE_AVAILABLE",
                );
                return { content: [{ text: "AUTO_AWS_COMMAND_COMPLETE", type: "text" }] };
            },
            permissionMode: "auto",
            rows: 30,
        });
        running.add(gym);

        submit(gym, "Use my developer AWS profile to check the current identity.");
        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("AUTO_AWS_COMMAND_COMPLETE") &&
                snapshot.text.includes("Ask Rig to do anything") &&
                snapshot.scroll.atBottom,
            "AWS command with normal developer credentials",
            30_000,
        );

        expect(completed.text).toContain("AWS_PROFILE_AVAILABLE");
        expect(completed.text).not.toContain("Approved automatically");
        expect(completed.text).not.toContain("Allow once");
        expect(completed.text).not.toContain("TEST_SECRET");
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
