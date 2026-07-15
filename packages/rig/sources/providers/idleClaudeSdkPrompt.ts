import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export async function* idleClaudeSdkPrompt(): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>(() => {});
}
