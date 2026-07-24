import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { SessionToolResultMessage } from "@/core/SessionContext.js";

type ToolResolver = (result: CallToolResult) => void;

export class ClaudeToolBridge {
    private readonly answers = new Map<string, CallToolResult>();
    private readonly callIdsByName = new Map<string, string[]>();
    private readonly openCallIds = new Set<string>();
    private readonly resolvers = new Map<string, ToolResolver>();

    register(callId: string, name: string): void {
        if (this.openCallIds.has(callId)) return;
        this.openCallIds.add(callId);
        const callIds = this.callIdsByName.get(name) ?? [];
        callIds.push(callId);
        this.callIdsByName.set(name, callIds);
    }

    execute(name: string): Promise<CallToolResult> {
        const callId = this.takeCallId(name);
        if (callId === undefined) {
            return Promise.resolve({
                content: [{ type: "text", text: `Rig received an unmatched ${name} tool call.` }],
                isError: true,
            });
        }
        const answer = this.answers.get(callId);
        if (answer !== undefined) {
            this.answers.delete(callId);
            this.openCallIds.delete(callId);
            return Promise.resolve(answer);
        }
        return new Promise((resolve) => {
            this.resolvers.set(callId, resolve);
        });
    }

    resolve(message: SessionToolResultMessage): boolean {
        if (!this.openCallIds.has(message.callId) || this.answers.has(message.callId)) return false;
        const answer = toCallToolResult(message);
        const resolver = this.resolvers.get(message.callId);
        if (resolver === undefined) {
            this.answers.set(message.callId, answer);
            return true;
        }
        this.resolvers.delete(message.callId);
        this.openCallIds.delete(message.callId);
        resolver(answer);
        return true;
    }

    resolveAll(messages: readonly SessionToolResultMessage[]): boolean {
        let resolved = 0;
        for (const message of messages) {
            if (this.resolve(message)) resolved += 1;
        }
        return messages.length > 0 && resolved === messages.length;
    }

    close(): void {
        const answer: CallToolResult = {
            content: [{ type: "text", text: "Claude session closed before the tool completed." }],
            isError: true,
        };
        for (const resolver of this.resolvers.values()) resolver(answer);
        this.answers.clear();
        this.callIdsByName.clear();
        this.openCallIds.clear();
        this.resolvers.clear();
    }

    private takeCallId(name: string): string | undefined {
        const callIds = this.callIdsByName.get(name);
        const callId = callIds?.shift();
        if (callIds?.length === 0) this.callIdsByName.delete(name);
        return callId;
    }
}

function toCallToolResult(message: SessionToolResultMessage): CallToolResult {
    if (message.input === undefined) {
        return {
            content: [{ type: "text", text: message.content }],
            ...(message.isError === undefined ? {} : { isError: message.isError }),
        };
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
        ...(message.isError === undefined ? {} : { isError: message.isError }),
    };
}
