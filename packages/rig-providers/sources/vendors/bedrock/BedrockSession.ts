import { BaseSession } from "@/core/BaseSession.js";
import type { SessionContext } from "@/core/SessionContext.js";
import type { SessionCompaction, SessionCompactionOptions } from "@/core/SessionCompaction.js";
import type { SessionCacheUsage } from "@/core/SessionCacheUsage.js";
import type { SessionEvent, SessionStream } from "@/core/SessionEvent.js";
import { isSessionErrorDone } from "@/core/SessionEvent.js";
import type { SessionRunRequest } from "@/core/SessionRunRequest.js";
import type { SessionOptions } from "@/core/SessionOptions.js";
import { withInitialSessionMessages } from "@/core/withInitialSessionMessages.js";
import { createOpenAIResponseRequest } from "@/responses/createOpenAIResponseRequest.js";
import { mapOpenAIResponseStream } from "@/responses/mapOpenAIResponseStream.js";
import type { BedrockCredential } from "@/vendors/VendorCredential.js";
import {
    createBedrockClient,
    type BedrockClient,
} from "@/vendors/bedrock/impl/createBedrockClient.js";
import { classifyCodexError } from "@/vendors/codex/impl/classifyCodexError.js";

const COMPACTION_PROMPT =
    "Provide a concise summary of the conversation so far. Output only the summary.";

export interface BedrockSessionOptions extends SessionOptions {
    credential: BedrockCredential;
    endpoint?: string;
    model?: string;
    region: string;
    userAgent: string;
}

export class BedrockSession extends BaseSession {
    readonly credential: BedrockCredential;
    readonly endpoint: string | undefined;
    readonly model: string | undefined;
    readonly region: string;
    readonly userAgent: string;
    private client: BedrockClient | undefined;
    private context: SessionContext;
    private readonly initialMessages: SessionContext["messages"];

    constructor(id: string, options: BedrockSessionOptions) {
        super(id);
        this.credential = options.credential;
        this.context = { ...options.context, messages: [...options.context.messages] };
        this.initialMessages = [...options.context.messages];
        this.endpoint = options.endpoint;
        this.model = options.model;
        this.region = options.region;
        this.userAgent = options.userAgent;
    }

    run(request: SessionRunRequest): SessionStream {
        if (request.abort?.aborted) return emptyStream();
        return this.streamRun(request);
    }

    async compact(options: SessionCompactionOptions = {}): Promise<SessionCompaction> {
        const { signal } = options;
        const context = this.context;
        let summary = "";
        let encryptedReasoning: string | undefined;
        let usage: SessionCacheUsage | undefined;
        for await (const event of this.run({
            context: {
                ...context,
                messages: [
                    ...context.messages.slice(this.initialMessages.length),
                    { role: "user", content: COMPACTION_PROMPT },
                ],
            },
            ...(signal === undefined ? {} : { abort: signal }),
        })) {
            if (event.type === "text_delta") summary += event.delta;
            if (event.type === "encrypted_reasoning") encryptedReasoning = event.content;
            if (event.type === "token_usage") usage = event.usage;
            if (isSessionErrorDone(event)) throw new Error(`[${event.kind}] ${event.message}`);
        }
        if (signal?.aborted) return { status: "cancelled", context };
        if (!summary.trim()) throw new Error("Compaction returned an empty summary.");
        const trimmed = summary.trim();
        const preservedMessages: SessionContext["messages"] = [];
        this.context = {
            instructions: context.instructions,
            messages: [
                {
                    role: "user",
                    content: `<conversation_summary>\n${trimmed}\n</conversation_summary>`,
                },
            ],
        };
        return {
            status: "completed",
            summary: trimmed,
            ...(encryptedReasoning === undefined ? {} : { encryptedReasoning }),
            preservedMessages,
            ...(usage === undefined ? {} : { usage }),
            context: this.context,
        };
    }

    destroy(): void {
        this.client = undefined;
    }

    private async *streamRun(request: SessionRunRequest): AsyncGenerator<SessionEvent> {
        try {
            this.context = {
                instructions: this.context.instructions,
                messages: withInitialSessionMessages(
                    this.initialMessages,
                    request.context.messages,
                ),
            };
            const model = request.model ?? this.model;
            if (model === undefined)
                throw new Error("A model is required for Amazon Bedrock inference.");
            const client = this.resolveClient();
            const response = await client.responses.create(
                createOpenAIResponseRequest({
                    context: this.context,
                    model,
                    promptCacheKey: this.id,
                    ...(request.effort === undefined ? {} : { effort: request.effort }),
                }),
                ...(request.abort === undefined ? [] : [{ signal: request.abort }]),
            );
            yield* mapOpenAIResponseStream(response, {
                failureMessage: "Amazon Bedrock Mantle failed to generate a response.",
                ...(request.abort === undefined ? {} : { signal: request.abort }),
            });
        } catch (error) {
            if (request.abort?.aborted) return;
            const message = error instanceof Error ? error.message : String(error);
            yield { type: "done", state: "error", kind: classifyCodexError(message), message };
        }
    }

    private resolveClient(): BedrockClient {
        return (this.client ??= createBedrockClient({
            bearerToken: this.credential.credential.bearerToken,
            region: this.region,
            userAgent: this.userAgent,
            ...(this.endpoint === undefined ? {} : { endpoint: this.endpoint }),
        }));
    }
}

function emptyStream(): SessionStream {
    async function* stream(): AsyncGenerator<SessionEvent> {}
    return stream();
}
