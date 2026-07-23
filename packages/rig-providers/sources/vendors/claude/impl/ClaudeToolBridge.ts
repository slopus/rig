import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { SessionToolResultMessage } from "@/core/SessionContext.js";

interface PendingClaudeTool {
    readonly callId: string;
    readonly name: string;
    result?: CallToolResult;
    resolve?: (result: CallToolResult) => void;
}

export class ClaudeToolBridge {
    private readonly pending: PendingClaudeTool[] = [];

    register(callId: string, name: string): void {
        this.pending.push({ callId, name });
    }

    execute(name: string): Promise<CallToolResult> {
        const pending = this.pending.find(
            (candidate) => candidate.name === name && candidate.resolve === undefined,
        );
        if (pending === undefined) {
            return Promise.resolve({
                content: [{ type: "text", text: `Rig received an unmatched ${name} tool call.` }],
                isError: true,
            });
        }
        if (pending.result !== undefined) return Promise.resolve(pending.result);
        return new Promise((resolve) => {
            pending.resolve = resolve;
        });
    }

    resolve(message: SessionToolResultMessage): boolean {
        const index = this.pending.findIndex((candidate) => candidate.callId === message.callId);
        if (index < 0) return false;
        const [pending] = this.pending.splice(index, 1);
        if (pending === undefined) return false;
        const result = toCallToolResult(message);
        pending.result = result;
        pending.resolve?.(result);
        return true;
    }

    close(): void {
        const result: CallToolResult = {
            content: [{ type: "text", text: "Claude session closed before the tool completed." }],
            isError: true,
        };
        for (const pending of this.pending.splice(0)) pending.resolve?.(result);
    }
}

function toCallToolResult(message: SessionToolResultMessage): CallToolResult {
    if (message.input === undefined) {
        return { content: [{ type: "text", text: message.content }] };
    }
    return {
        content: message.input.map((block) =>
            block.type === "text"
                ? { type: "text" as const, text: block.text }
                : {
                      type: "image" as const,
                      data: block.data,
                      mimeType: block.mimeType,
                  },
        ),
    };
}
