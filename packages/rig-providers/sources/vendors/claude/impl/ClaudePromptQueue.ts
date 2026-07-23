import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export class ClaudePromptQueue implements AsyncIterable<SDKUserMessage> {
    private readonly pending: SDKUserMessage[] = [];
    private readonly waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
    private closed = false;

    enqueue(message: SDKUserMessage): void {
        if (this.closed) throw new Error("Claude prompt queue is closed.");
        const waiter = this.waiters.shift();
        if (waiter === undefined) {
            this.pending.push(message);
        } else {
            waiter({ done: false, value: message });
        }
    }

    close(): void {
        this.closed = true;
        for (const waiter of this.waiters.splice(0)) {
            waiter({ done: true, value: undefined });
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        return {
            next: () => {
                const message = this.pending.shift();
                if (message !== undefined) {
                    return Promise.resolve({ done: false as const, value: message });
                }
                if (this.closed) {
                    return Promise.resolve({ done: true as const, value: undefined });
                }
                return new Promise((resolve) => this.waiters.push(resolve));
            },
        };
    }
}
