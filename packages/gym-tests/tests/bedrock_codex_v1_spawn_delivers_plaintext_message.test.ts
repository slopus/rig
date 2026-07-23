import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("Bedrock Codex v1 collaboration", () => {
    it("delivers multi_agent_v1 spawn_agent messages to the child as plaintext", async () => {
        const task = "Inspect the Bedrock v1 collaboration path.";
        let parentSessionId: string | undefined;
        let childReceivedPlaintext = false;
        const gym = await createGym({
            environment: {
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-token",
                AWS_REGION: "us-east-1",
                RIG_GYM_PROVIDER_OVERRIDES: "bedrock",
            },
            inference(request) {
                const sessionId = request.options.sessionId;
                if (sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Bedrock v1 delegation", type: "text" }] };
                }
                parentSessionId ??= sessionId;

                if (sessionId !== parentSessionId) {
                    const messages = JSON.stringify(request.context.messages);
                    expect(messages).toContain(task);
                    expect(messages).not.toContain("encryptedAgentMessage");
                    childReceivedPlaintext = true;
                    return { content: [{ text: "BEDROCK_V1_CHILD_DONE", type: "text" }] };
                }

                const last = JSON.stringify(request.context.messages.at(-1));
                if (last.includes("Delegate through Bedrock v1.")) {
                    expect(
                        request.context.tools?.some(
                            (tool) =>
                                tool.name === "spawn_agent" && tool.namespace === "multi_agent_v1",
                        ),
                    ).toBe(true);
                    return {
                        content: [
                            {
                                arguments: { message: task },
                                id: "spawn-bedrock-v1-audit",
                                name: "spawn_agent",
                                namespace: "multi_agent_v1",
                                type: "toolCall",
                            },
                        ],
                    };
                }
                return { content: [{ text: "PARENT_STARTED_BEDROCK_V1_CHILD", type: "text" }] };
            },
            modelId: "openai/gpt-5.6-sol",
            providerId: "bedrock",
            rows: 24,
        });
        running.add(gym);

        gym.terminal.type("Delegate through Bedrock v1.");
        gym.terminal.press("enter");

        const result = await gym.terminal.waitUntil(
            (snapshot) =>
                childReceivedPlaintext && snapshot.text.includes('"Delegated task" completed in'),
            "the Bedrock v1 plaintext task to reach the child and complete",
            30_000,
        );
        expect(result.text).not.toContain("Invalid arguments");
        expect(result.text).not.toContain("Tool 'multi_agent_v1.spawn_agent' failed");
    }, 60_000);
});
