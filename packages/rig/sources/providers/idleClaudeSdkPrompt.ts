import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export async function* idleClaudeSdkPrompt(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
    await new Promise<void>((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
    });
}
