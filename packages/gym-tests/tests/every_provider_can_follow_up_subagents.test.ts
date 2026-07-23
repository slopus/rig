import { afterEach, describe, expect, it } from "vitest";

import { createGym, type Gym } from "@slopus/rig-gym";

const running = new Set<Gym>();

afterEach(async () => {
    await Promise.all([...running].map((gym) => gym.dispose()));
    running.clear();
});

describe("follow-up tools across provider profiles", () => {
    it("gives Codex, Claude, Grok, and Bedrock a retained-subagent follow-up tool", async () => {
        const verifiedProviders = new Set<string>();
        const observedTools = new Map<string, readonly string[]>();
        let parentStarted = false;
        const gym = await createGym({
            environment: {
                ANTHROPIC_API_KEY: "claude-test-key",
                AWS_BEARER_TOKEN_BEDROCK: "bedrock-test-token",
                AWS_REGION: "us-east-1",
                RIG_GYM_PROVIDER_OVERRIDES: "bedrock,claude,grok",
                XAI_API_KEY: "grok-test-key",
            },
            inference(request) {
                const tools = request.context.tools?.map((tool) => tool.name) ?? [];
                if (request.providerId !== "gym") {
                    observedTools.set(request.providerId, tools);
                    verifiedProviders.add(request.providerId);
                    return {
                        content: [
                            {
                                text: `FOLLOWUP_TOOL_OK_${request.providerId.toUpperCase()}`,
                                type: "text",
                            },
                        ],
                    };
                }

                if (request.options.sessionId?.endsWith(":title") === true) {
                    return { content: [{ text: "Provider follow-up tools", type: "text" }] };
                }
                expect(tools).toContain("followup_task");
                const lastMessage = request.context.messages.at(-1);
                const lastText = messageText(lastMessage);
                if (!parentStarted) {
                    parentStarted = true;
                    return {
                        content: [
                            spawnCall("claude", "anthropic/sonnet-5", "high"),
                            spawnCall("grok", "xai/grok-4.5", "high"),
                            spawnCall("bedrock", "openai/gpt-5.6-sol", "high"),
                        ],
                    };
                }
                if (lastText.includes("<subagent-notification>")) {
                    return { content: [{ text: "PARENT_NOTED_FOLLOWUP_TOOL", type: "text" }] };
                }
                if (lastMessage?.role === "toolResult") {
                    return { content: [{ text: "PARENT_SPAWNED_PROVIDERS", type: "text" }] };
                }
                return { content: [{ text: "PROVIDER_FOLLOWUP_METADATA", type: "text" }] };
            },
            rows: 34,
        });
        running.add(gym);

        gym.terminal.type("Verify every provider can follow up retained subagents.");
        gym.terminal.press("enter");

        const completed = await gym.terminal.waitUntil(
            (snapshot) =>
                snapshot.text.includes("PARENT_SPAWNED_PROVIDERS") &&
                snapshot.text.includes('"Bedrock followup tool" completed in'),
            "every provider profile to receive its follow-up tool",
            30_000,
        );
        expect([...verifiedProviders].sort()).toEqual(["bedrock", "claude", "grok"]);
        expect(observedTools.get("claude")).toContain("SendMessage");
        expect(observedTools.get("grok")).toContain("followup_subagent");
        expect(observedTools.get("bedrock")).toContain("tool_search");
        expect(completed.text).not.toContain("Tool 'spawn_agent' failed");
    }, 120_000);
});

function spawnCall(provider: string, model: string, effort: string) {
    return {
        arguments: {
            context: "task",
            effort,
            message: `Confirm the ${provider} follow-up tool.`,
            model,
            provider,
            task_name: `${provider}_followup_tool`,
        },
        id: `spawn-${provider}-followup-tool`,
        name: "spawn_agent",
        type: "toolCall" as const,
    };
}

function messageText(
    message: { content: string | readonly { text?: string; type: string }[] } | undefined,
): string {
    if (message === undefined) return "";
    if (typeof message.content === "string") return message.content;
    return message.content
        .filter((block): block is { text: string; type: string } => typeof block.text === "string")
        .map((block) => block.text)
        .join("");
}
