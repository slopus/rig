import { BaseSession } from "@/core/BaseSession.js";
import type { SessionCacheUsage } from "@/core/SessionCacheUsage.js";
import type { SessionCompaction, SessionCompactionOptions } from "@/core/SessionCompaction.js";
import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionEvent, SessionStream } from "@/core/SessionEvent.js";
import type { SessionRunRequest } from "@/core/SessionRunRequest.js";
import type { SessionOptions } from "@/core/SessionOptions.js";
import { withInitialSessionMessages } from "@/core/withInitialSessionMessages.js";
export interface ResponsesSessionOptions extends SessionOptions {}

export class ResponsesSession extends BaseSession {
    private context: SessionContext;
    private readonly initialMessages: SessionContext["messages"];

    constructor(id: string, options: ResponsesSessionOptions) {
        super(id);
        this.context = { ...options.context, messages: [...options.context.messages] };
        this.initialMessages = [...options.context.messages];
    }

    run(request: SessionRunRequest): SessionStream {
        if (request.abort?.aborted) {
            return emptySessionStream();
        }

        return this.streamRun(request);
    }

    async compact(options: SessionCompactionOptions = {}): Promise<SessionCompaction> {
        const { signal } = options;
        const context = this.context;
        if (signal?.aborted) {
            return { status: "cancelled", context };
        }

        const lastUser = [...context.messages].reverse().find((message) => message.role === "user");
        const summary = lastUser?.content ?? "";
        const preservedMessages = [...this.initialMessages];
        this.context = {
            instructions: context.instructions,
            messages: [
                ...preservedMessages,
                {
                    role: "user",
                    content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
                },
            ],
        };
        return {
            status: "completed",
            summary,
            preservedMessages,
            context: this.context,
        };
    }

    destroy(): void {}

    private async *streamRun(request: SessionRunRequest): AsyncGenerator<SessionEvent> {
        const { abort } = request;
        this.context = {
            instructions: this.context.instructions,
            messages: withInitialSessionMessages(this.initialMessages, request.context.messages),
        };
        const context = this.context;

        if (abort?.aborted) {
            return;
        }

        const lastUser = [...context.messages].reverse().find((message) => message.role === "user");
        if (lastUser === undefined) {
            yield {
                type: "done",
                state: "error",
                kind: "unknown",
                message: "Session context is missing a user message.",
            };
            return;
        }

        const usage: SessionCacheUsage = {
            input: lastUser.content.length,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: lastUser.content.length,
        };
        yield { type: "token_usage", usage };
        yield { type: "done", state: "normal" };
    }
}

function emptySessionStream(): SessionStream {
    async function* generator(): AsyncGenerator<SessionEvent> {}
    return generator();
}
