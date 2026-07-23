import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// eslint-disable-next-line require-yield -- The SDK requires an async iterable that stays idle.
export async function* idleClaudeSdkPrompt(): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>(() => {});
}
