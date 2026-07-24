import { randomUUID } from "node:crypto";

import type OpenAI from "openai";
import type {
    ResponseOutputItem,
    ResponseStreamEvent,
} from "openai/resources/responses/responses.js";
import { ResponsesWS } from "openai/resources/responses/ws";

import { BaseSession } from "@/core/BaseSession.js";
import type { SessionCompaction, SessionCompactionOptions } from "@/core/SessionCompaction.js";
import type { SessionContext, SessionMessage } from "@/core/SessionContext.js";
import type { SessionEvent, SessionStream } from "@/core/SessionEvent.js";
import type { SessionModelConfiguration } from "@/core/SessionModelConfiguration.js";
import type { SessionReasoningEffort, SessionRunRequest } from "@/core/SessionRunRequest.js";
import type { SessionSkill } from "@/core/SessionSkill.js";
import type { SessionTool } from "@/core/SessionTool.js";
import { mapOpenAIResponseStream } from "@/responses/mapOpenAIResponseStream.js";
import type { CodexProviderCredential } from "@/vendors/VendorCredential.js";
import { classifyCodexError } from "@/vendors/codex/impl/classifyCodexError.js";
import { codexModelsShareConfiguration } from "@/vendors/codex/impl/codexModelsShareConfiguration.js";
import { collectCodexCompaction } from "@/vendors/codex/impl/collectCodexCompaction.js";
import { createCodexBedrockRequest } from "@/vendors/codex/impl/createCodexBedrockRequest.js";
import type { CodexResponseRequest } from "@/vendors/codex/impl/CodexResponseRequest.js";
import { createCodexClient } from "@/vendors/codex/impl/createCodexClient.js";
import { createCodexClientMetadata } from "@/vendors/codex/impl/createCodexClientMetadata.js";
import { createCodexCompactionRequest } from "@/vendors/codex/impl/createCodexCompactionRequest.js";
import { createCodexCliSseRequest } from "@/vendors/codex/impl/createCodexCliSseRequest.js";
import { createCodexCliWebSocketInferenceRequest } from "@/vendors/codex/impl/createCodexCliWebSocketInferenceRequest.js";
import {
    createCodexCliRequest,
    createCodexCliWarmupRequest,
} from "@/vendors/codex/impl/createCodexCliRequest.js";
import { createCodexModelSwitchMessage } from "@/vendors/codex/impl/createCodexModelSwitchMessage.js";
import { createCodexRequestHeaders } from "@/vendors/codex/impl/createCodexRequestHeaders.js";
import { createCodexWebSocketStream } from "@/vendors/codex/impl/createCodexWebSocketStream.js";
import type { CodexCompactionMetadata } from "@/vendors/codex/impl/CodexCompactionMetadata.js";
import { fitCodexCompactionRequest } from "@/vendors/codex/impl/fitCodexCompactionRequest.js";
import { getCodexContextSuffix } from "@/vendors/codex/impl/getCodexContextSuffix.js";
import { getCodexIncrementalInput } from "@/vendors/codex/impl/getCodexIncrementalInput.js";
import { getCodexModelProperties } from "@/vendors/codex/impl/getCodexModelProperties.js";
import { getCodexTurnKey } from "@/vendors/codex/impl/getCodexTurnKey.js";
import { isCodexContextWindowError } from "@/vendors/codex/impl/isCodexContextWindowError.js";
import { isCodexUnauthorizedError } from "@/vendors/codex/impl/isCodexUnauthorizedError.js";
import { isCodexV2Model } from "@/vendors/codex/impl/isCodexV2Model.js";
import { isCodexWebSocketUnavailableError } from "@/vendors/codex/impl/isCodexWebSocketUnavailableError.js";
import { isRetryableCodexStreamError } from "@/vendors/codex/impl/isRetryableCodexStreamError.js";
import { preserveCodexCompactionMessages } from "@/vendors/codex/impl/preserveCodexCompactionMessages.js";
import { preserveCodexLocalCompactionMessages } from "@/vendors/codex/impl/preserveCodexLocalCompactionMessages.js";
import { recoverCodexUnauthorizedCredential } from "@/vendors/codex/impl/recoverCodexUnauthorizedCredential.js";
import { readCodexTurnState } from "@/vendors/codex/impl/readCodexTurnState.js";
import { readCodexTurnStateHeader } from "@/vendors/codex/impl/readCodexTurnStateHeader.js";
import { resolveCodexReasoningEffort } from "@/vendors/codex/impl/resolveCodexReasoningEffort.js";
import { resolveCodexModelId } from "@/vendors/codex/impl/resolveCodexModelId.js";
import { resolveCodexStreamIdleTimeout } from "@/vendors/codex/impl/resolveCodexStreamIdleTimeout.js";
import { resolveCodexStreamMaxRetries } from "@/vendors/codex/impl/resolveCodexStreamMaxRetries.js";
import { setCodexRequestKind } from "@/vendors/codex/impl/setCodexRequestKind.js";
import { stripCodexInitialMessages } from "@/vendors/codex/impl/stripCodexInitialMessages.js";
import { waitForCodexCompactionRetry } from "@/vendors/codex/impl/waitForCodexCompactionRetry.js";
import { waitForCodexRetry } from "@/vendors/codex/impl/waitForCodexRetry.js";
import { withCodexStreamIdleTimeout } from "@/vendors/codex/impl/withCodexStreamIdleTimeout.js";
import {
    context_checkpoint_compaction_instructions,
    context_checkpoint_summary_prefix,
} from "@/vendors/codex/prompts/context_checkpoint_compaction_instructions.js";
import type { CodexTransport } from "@/vendors/codex/impl/codexConstants.js";

const CODEX_COMPACTION_MAX_RETRIES = 2;

export interface CodexSessionOptions {
    context: SessionContext;
    credential: CodexProviderCredential;
    endpoint: string;
    installationId: string;
    model?: string;
    modelConfigurations?: Readonly<Record<string, SessionModelConfiguration>>;
    parallelToolCalls?: boolean;
    skills?: readonly SessionSkill[];
    /** Maximum stream reconnection attempts per transport, matching upstream Codex. */
    streamMaxRetries?: number;
    streamIdleTimeoutMs?: number;
    tools?: readonly SessionTool[];
    transport?: CodexTransport;
    userAgent: string;
}

export class CodexSession extends BaseSession {
    credential: CodexProviderCredential;
    readonly endpoint: string;
    readonly model: string | undefined;
    readonly parallelToolCalls: boolean | undefined;
    readonly skills: readonly SessionSkill[];
    readonly streamMaxRetries: number;
    readonly streamIdleTimeoutMs: number;
    readonly tools: readonly SessionTool[];
    readonly transport: CodexTransport;
    readonly userAgent: string;

    private activeConfiguration: SessionModelConfiguration;
    private activeEffort: SessionReasoningEffort | undefined;
    private activeModel: string | undefined;
    private client: OpenAI | undefined;
    private context: SessionContext;
    private forceSse = false;
    private readonly installationId: string;
    private readonly modelConfigurations = new Map<string, SessionModelConfiguration>();
    private previousRequest: CodexResponseRequest | undefined;
    private previousResponseId: string | undefined;
    private previousResponseItems: readonly ResponseOutputItem[] = [];
    private socket: ResponsesWS | undefined;
    private turnId = randomUUID();
    private turnKey: string | undefined;
    private turnState: string | undefined;
    private windowId = randomUUID();
    private websocketInferenceStarted = false;
    private websocketNeedsFullRequest = false;
    private websocketStarted = false;

    constructor(id: string, options: CodexSessionOptions) {
        super(id);
        this.credential = options.credential;
        this.endpoint = options.endpoint;
        this.installationId = options.installationId;
        this.model = options.model;
        this.parallelToolCalls = options.parallelToolCalls;
        this.activeModel = options.model;
        this.skills = options.skills ?? [];
        this.streamMaxRetries = resolveCodexStreamMaxRetries(options.streamMaxRetries);
        this.streamIdleTimeoutMs = resolveCodexStreamIdleTimeout(options.streamIdleTimeoutMs);
        this.tools = options.tools ?? [];
        this.transport = options.transport ?? "auto";
        this.userAgent = options.userAgent;

        const baseConfiguration = cloneConfiguration({
            context: options.context,
            skills: this.skills,
            tools: this.tools,
        });
        for (const [model, configuration] of Object.entries(options.modelConfigurations ?? {})) {
            this.modelConfigurations.set(model, cloneConfiguration(configuration));
        }
        if (options.model !== undefined && !this.modelConfigurations.has(options.model)) {
            this.modelConfigurations.set(options.model, baseConfiguration);
        }
        this.activeConfiguration =
            (options.model === undefined
                ? undefined
                : this.modelConfigurations.get(options.model)) ?? baseConfiguration;
        this.context = cloneContext(this.activeConfiguration.context);
    }

    run(request: SessionRunRequest): SessionStream {
        if (request.abort?.aborted) return cancelledStream();
        return this.streamRun(request);
    }

    async compact(options: SessionCompactionOptions = {}): Promise<SessionCompaction> {
        const { signal } = options;
        if (signal?.aborted) return { status: "cancelled", context: this.context };
        const model = this.activeModel ?? this.model;
        if (model === undefined) throw new Error("A model is required for Codex compaction.");
        const effort = resolveCodexReasoningEffort(model, this.activeEffort);
        this.beginTurn(`compaction:${randomUUID()}`);
        return this.compactContext(
            this.activeConfiguration,
            model,
            effort,
            {
                trigger: "manual",
                reason: "user_requested",
                implementation: "responses_compaction_v2",
                phase: "standalone_turn",
                strategy: "memento",
            },
            signal,
        );
    }

    destroy(): void {
        this.closeSocket("session destroyed");
        this.client = undefined;
    }

    private async compactContext(
        configuration: SessionModelConfiguration,
        model: string,
        effort: SessionReasoningEffort,
        metadata: CodexCompactionMetadata,
        signal?: AbortSignal,
    ): Promise<SessionCompaction> {
        const context = this.context;
        if (signal?.aborted) return { status: "cancelled", context };
        if (this.credential.name === "bedrock-bearer-token") {
            return this.compactBedrockContext(
                context,
                configuration,
                model,
                effort,
                { ...metadata, implementation: "responses" },
                signal,
            );
        }
        const basePayload = createCodexCompactionRequest(
            this.createRequest(context, configuration, model, effort),
            metadata,
        );
        const contextWindow = getCodexModelProperties(model)?.contextWindow ?? 272_000;
        let fittedContextWindow = contextWindow;
        let payload = fitCodexCompactionRequest(
            basePayload,
            configuration.tools ?? [],
            fittedContextWindow,
        );
        let useSse = this.transport === "sse" || (this.transport === "auto" && this.forceSse);
        let contextWindowRetries = 0;
        let transportRetries = 0;
        let unauthorizedRecoveryStep = 0;
        const maxRetries = Math.min(this.streamMaxRetries, CODEX_COMPACTION_MAX_RETRIES);

        for (;;) {
            try {
                const stream = useSse
                    ? await this.sse(payload, configuration.tools ?? [], model, signal)
                    : this.websocket(payload, configuration.tools ?? [], signal);
                const collected = await collectCodexCompaction(
                    stream,
                    signal === undefined ? {} : { signal },
                );
                if (signal?.aborted) return { status: "cancelled", context };
                const compaction = {
                    role: "compaction" as const,
                    content: collected.item.encrypted_content,
                };
                const preservedMessages = preserveCodexCompactionMessages(context.messages);
                this.context = {
                    instructions: context.instructions,
                    messages: [...preservedMessages, compaction],
                };
                this.windowId = randomUUID();
                this.clearWebsocketResponseChain();
                return {
                    status: "completed",
                    compaction,
                    preservedMessages,
                    usage: collected.usage,
                    context: this.context,
                };
            } catch (error) {
                if (!useSse) this.resetWebsocketConnection("compaction did not complete");
                if (signal?.aborted) return { status: "cancelled", context };
                if (isCodexUnauthorizedError(error)) {
                    const recovered = await recoverCodexUnauthorizedCredential(
                        this.credential,
                        unauthorizedRecoveryStep,
                    );
                    if (recovered !== undefined) {
                        unauthorizedRecoveryStep += 1;
                        this.replaceCredential(recovered);
                        continue;
                    }
                }
                if (
                    isCodexContextWindowError(error) &&
                    contextWindowRetries < CODEX_COMPACTION_MAX_RETRIES
                ) {
                    contextWindowRetries += 1;
                    fittedContextWindow = Math.floor(fittedContextWindow * 0.9);
                    payload = fitCodexCompactionRequest(
                        basePayload,
                        configuration.tools ?? [],
                        fittedContextWindow,
                    );
                    transportRetries = 0;
                    continue;
                }
                if (
                    isRetryableCodexStreamError(error) &&
                    (useSse || !isCodexWebSocketUnavailableError(error)) &&
                    transportRetries < maxRetries
                ) {
                    transportRetries += 1;
                    try {
                        await waitForCodexCompactionRetry(transportRetries, signal);
                    } catch (delayError) {
                        if (signal?.aborted) return { status: "cancelled", context };
                        throw delayError;
                    }
                    continue;
                }
                if (
                    this.transport === "auto" &&
                    !useSse &&
                    (isRetryableCodexStreamError(error) || isCodexWebSocketUnavailableError(error))
                ) {
                    this.forceSse = true;
                    useSse = true;
                    transportRetries = 0;
                    continue;
                }
                throw error;
            }
        }
    }

    private async compactBedrockContext(
        context: SessionContext,
        configuration: SessionModelConfiguration,
        model: string,
        effort: SessionReasoningEffort,
        metadata: CodexCompactionMetadata,
        signal?: AbortSignal,
    ): Promise<SessionCompaction> {
        const compactionContext: SessionContext = {
            instructions: context.instructions,
            messages: [
                ...context.messages,
                { role: "user", content: context_checkpoint_compaction_instructions },
            ],
        };
        const compactionConfiguration: SessionModelConfiguration = {
            context: configuration.context,
            skills: [],
            tools: [],
        };
        const basePayload = this.createRequest(
            compactionContext,
            compactionConfiguration,
            model,
            effort,
        );
        const contextWindow = getCodexModelProperties(model)?.contextWindow ?? 272_000;
        let fittedContextWindow = contextWindow;
        let payload = fitCodexCompactionRequest(basePayload, [], fittedContextWindow);
        setCodexRequestKind(payload, "compaction", metadata);
        let contextWindowRetries = 0;
        let retries = 0;
        const maxRetries = Math.min(this.streamMaxRetries, CODEX_COMPACTION_MAX_RETRIES);
        for (;;) {
            try {
                const stream = await this.sse(payload, [], model, signal);
                const mapped = mapOpenAIResponseStream(stream, {
                    failureMessage: `${model} failed to compact the conversation.`,
                    ...(signal === undefined ? {} : { signal }),
                });
                let result: Awaited<ReturnType<typeof mapped.next>>["value"] | undefined;
                for (;;) {
                    const next = await mapped.next();
                    if (next.done) {
                        result = next.value;
                        break;
                    }
                }
                if (signal?.aborted) return { status: "cancelled", context };
                if (result === undefined || !("assistantText" in result)) {
                    throw new Error("Bedrock compaction completed without a summary.");
                }
                const summary = result.assistantText.trim();
                if (summary.length === 0)
                    throw new Error("Bedrock compaction returned an empty summary.");
                const preservedMessages = preserveCodexLocalCompactionMessages(context.messages);
                this.context = {
                    instructions: context.instructions,
                    messages: [
                        ...preservedMessages,
                        {
                            role: "user",
                            content: `${context_checkpoint_summary_prefix}\n${summary}`,
                        },
                    ],
                };
                this.windowId = randomUUID();
                this.clearWebsocketResponseChain();
                return {
                    status: "completed",
                    summary,
                    preservedMessages,
                    usage: result.usage,
                    context: this.context,
                };
            } catch (error) {
                if (signal?.aborted) return { status: "cancelled", context };
                if (
                    isCodexContextWindowError(error) &&
                    contextWindowRetries < CODEX_COMPACTION_MAX_RETRIES
                ) {
                    contextWindowRetries += 1;
                    fittedContextWindow = Math.floor(fittedContextWindow * 0.9);
                    payload = fitCodexCompactionRequest(basePayload, [], fittedContextWindow);
                    setCodexRequestKind(payload, "compaction", metadata);
                    retries = 0;
                    continue;
                }
                if (isRetryableCodexStreamError(error) && retries < maxRetries) {
                    retries += 1;
                    await waitForCodexCompactionRetry(retries, signal);
                    continue;
                }
                throw error;
            }
        }
    }

    private async *streamRun(request: SessionRunRequest): AsyncGenerator<SessionEvent> {
        const requestedModel = request.model ?? this.activeModel;
        const model =
            requestedModel === undefined ? undefined : resolveCodexModelId(requestedModel);
        if (model === undefined) throw new Error("A model is required for Codex inference.");
        const configuration = this.resolveConfiguration(model);
        const effort = resolveCodexReasoningEffort(model, request.effort);
        const modelChanged = this.activeModel !== undefined && this.activeModel !== model;
        const knownInitialMessages = this.knownInitialMessageSets();
        const currentDynamic = stripCodexInitialMessages(
            this.context.messages,
            knownInitialMessages,
        );
        const rebuiltDynamic = stripCodexInitialMessages(
            request.context.messages,
            knownInitialMessages,
        );
        const appended = getCodexContextSuffix(currentDynamic, rebuiltDynamic);
        const nextTurnKey = getCodexTurnKey(request.context.messages);
        if (this.turnKey !== nextTurnKey) this.beginTurn(nextTurnKey);

        const history = appended === undefined ? [] : currentDynamic;
        const newMessages = appended ?? rebuiltDynamic;
        const messages: SessionMessage[] = [
            ...configuration.context.messages.map((message) => structuredClone(message)),
            ...history,
            ...(modelChanged
                ? [createCodexModelSwitchMessage(configuration.context.instructions)]
                : []),
            ...newMessages,
        ];
        this.context = {
            instructions: configuration.context.instructions,
            messages,
        };
        this.activeConfiguration = configuration;
        this.activeEffort = effort;
        this.activeModel = model;

        const payload = this.createRequest(
            this.context,
            configuration,
            model,
            effort,
            request.serviceTier,
        );
        let useSse = this.transport === "sse" || (this.transport === "auto" && this.forceSse);
        let transportRetries = 0;
        let reportedAttempt = 0;
        let unauthorizedRecoveryStep = 0;

        for (;;) {
            yield { type: "block_start" };
            try {
                const responseStream = useSse
                    ? await this.sse(payload, configuration.tools ?? [], model, request.abort)
                    : this.websocket(payload, configuration.tools ?? [], request.abort);
                const mapped = mapOpenAIResponseStream(responseStream, {
                    failureMessage: `${model} failed to generate a response.`,
                    ...(request.abort === undefined ? {} : { signal: request.abort }),
                });
                let result: Awaited<ReturnType<typeof mapped.next>>["value"] | undefined;
                let terminal: Extract<SessionEvent, { type: "done" }> | undefined;
                for (;;) {
                    const next = await mapped.next();
                    if (next.done) {
                        result = next.value;
                        break;
                    }
                    const event = next.value;
                    if (event.type === "done") {
                        terminal = event;
                        continue;
                    }
                    yield event;
                }

                if (request.abort?.aborted) {
                    if (!useSse) this.resetWebsocketConnection("request aborted");
                    yield { type: "block_reset" };
                    yield { type: "done", state: "cancelled" };
                    return;
                }
                if (terminal?.state === "error") {
                    if (!useSse) this.resetWebsocketConnection("response failed");
                    yield { type: "block_reset" };
                    yield terminal;
                    return;
                }
                if (result !== undefined && "assistantText" in result) {
                    if (
                        result.assistantText.length > 0 ||
                        result.encryptedReasoning !== undefined ||
                        result.toolCalls.length > 0
                    ) {
                        this.context = {
                            instructions: this.context.instructions,
                            messages: [
                                ...this.context.messages,
                                {
                                    role: "assistant",
                                    content: result.assistantText,
                                    ...(result.encryptedReasoning === undefined
                                        ? {}
                                        : { encryptedReasoning: result.encryptedReasoning }),
                                    ...(result.toolCalls.length === 0
                                        ? {}
                                        : { toolCalls: result.toolCalls }),
                                    ...(result.responseItems.length === 0
                                        ? {}
                                        : { responseItems: result.responseItems }),
                                },
                            ],
                        };
                    }
                }
                yield { type: "block_stop" };
                if (terminal !== undefined) yield terminal;
                return;
            } catch (error) {
                yield { type: "block_reset" };
                if (!useSse) this.resetWebsocketConnection("stream did not complete");
                if (request.abort?.aborted) {
                    yield { type: "done", state: "cancelled" };
                    return;
                }
                const message = error instanceof Error ? error.message : String(error);
                if (isCodexUnauthorizedError(error)) {
                    const recovered = await recoverCodexUnauthorizedCredential(
                        this.credential,
                        unauthorizedRecoveryStep,
                    );
                    if (recovered !== undefined) {
                        unauthorizedRecoveryStep += 1;
                        this.replaceCredential(recovered);
                        continue;
                    }
                }
                if (
                    isRetryableCodexStreamError(error) &&
                    (useSse || !isCodexWebSocketUnavailableError(error)) &&
                    transportRetries < this.streamMaxRetries
                ) {
                    transportRetries += 1;
                    reportedAttempt += 1;
                    yield {
                        type: "retrying",
                        attempt: reportedAttempt,
                        reason: `Stream disconnected; reconnecting: ${message}`,
                    };
                    try {
                        await waitForCodexRetry(transportRetries, error, request.abort);
                    } catch (delayError) {
                        if (request.abort?.aborted) {
                            yield { type: "done", state: "cancelled" };
                            return;
                        }
                        throw delayError;
                    }
                    continue;
                }
                if (
                    this.transport === "auto" &&
                    !useSse &&
                    (isRetryableCodexStreamError(error) || isCodexWebSocketUnavailableError(error))
                ) {
                    this.forceSse = true;
                    useSse = true;
                    transportRetries = 0;
                    reportedAttempt += 1;
                    yield {
                        type: "retrying",
                        attempt: reportedAttempt,
                        reason: `WebSocket retries exhausted; falling back to SSE: ${message}`,
                    };
                    continue;
                }
                yield {
                    type: "done",
                    state: "error",
                    kind: classifyCodexError(message),
                    message,
                };
                return;
            }
        }
    }

    private beginTurn(turnKey: string): void {
        this.turnId = randomUUID();
        this.turnKey = turnKey;
        this.turnState = undefined;
    }

    private createRequest(
        context: SessionContext,
        configuration: SessionModelConfiguration,
        model: string,
        effort: SessionReasoningEffort,
        serviceTier?: SessionRunRequest["serviceTier"],
    ): CodexResponseRequest {
        return createCodexCliRequest({
            clientMetadata: createCodexClientMetadata({
                installationId: this.installationId,
                requestKind: "turn",
                sessionId: this.id,
                turnId: this.turnId,
                windowId: this.windowId,
            }),
            context,
            effort,
            model,
            ...(this.parallelToolCalls === undefined
                ? {}
                : { parallelToolCalls: this.parallelToolCalls }),
            promptCacheKey: this.id,
            skills: configuration.skills ?? [],
            ...(serviceTier === undefined ? {} : { serviceTier }),
            tools: configuration.tools ?? [],
        });
    }

    private knownInitialMessageSets(): readonly (readonly SessionMessage[])[] {
        return [
            this.activeConfiguration.context.messages,
            ...[...this.modelConfigurations.values()].map(
                (configuration) => configuration.context.messages,
            ),
        ];
    }

    private resolveClient(): OpenAI {
        return (this.client ??= createCodexClient({
            credential: this.credential,
            endpoint: this.endpoint,
            installationId: this.installationId,
            sessionId: this.id,
            userAgent: this.userAgent,
            windowId: this.windowId,
        }));
    }

    private replaceCredential(credential: CodexProviderCredential): void {
        this.credential = credential;
        this.client = undefined;
        this.closeSocket("credentials changed");
        this.clearWebsocketResponseChain();
        this.websocketInferenceStarted = false;
        this.websocketStarted = false;
        this.websocketNeedsFullRequest = false;
    }

    private resolveConfiguration(model: string): SessionModelConfiguration {
        const explicit = this.modelConfigurations.get(model);
        if (explicit !== undefined) return explicit;
        if (this.activeModel === undefined) {
            this.modelConfigurations.set(model, this.activeConfiguration);
            return this.activeConfiguration;
        }
        if (codexModelsShareConfiguration(this.activeModel, model)) {
            this.modelConfigurations.set(model, this.activeConfiguration);
            return this.activeConfiguration;
        }
        throw new Error(
            `Codex model '${model}' requires a model configuration supplied when the session is created.`,
        );
    }

    private async sse(
        request: CodexResponseRequest,
        tools: readonly SessionTool[],
        model: string,
        signal?: AbortSignal,
    ) {
        const sseRequest = createCodexCliSseRequest(request, tools);
        const clientMetadata = sseRequest.client_metadata;
        const turnMetadata = clientMetadata?.["x-codex-turn-metadata"];
        const { data: stream, response } = await this.resolveClient()
            .responses.create(
                this.credential.name === "bedrock-bearer-token"
                    ? createCodexBedrockRequest(sseRequest)
                    : sseRequest,
                {
                    headers: createCodexRequestHeaders(
                        model,
                        this.turnState,
                        this.windowId,
                        typeof turnMetadata === "string" ? turnMetadata : undefined,
                        isCodexV2Model(model) && sseRequest.tools === undefined,
                    ),
                    ...(signal === undefined ? {} : { signal }),
                },
            )
            .withResponse();
        this.turnState ??= readCodexTurnStateHeader(response.headers);
        return this.observeTurnStateStream(
            withCodexStreamIdleTimeout({
                stream,
                timeoutMs: this.streamIdleTimeoutMs,
                ...(signal === undefined ? {} : { signal }),
            }),
        );
    }

    private async *observeTurnStateStream(
        stream: AsyncIterable<ResponseStreamEvent>,
    ): AsyncGenerator<ResponseStreamEvent> {
        for await (const event of stream) {
            this.observeTurnState(event);
            yield event;
        }
    }

    private async *websocket(
        request: CodexResponseRequest,
        tools: readonly SessionTool[],
        signal?: AbortSignal,
    ): AsyncGenerator<ResponseStreamEvent> {
        const client = this.resolveClient();
        this.socket ??= new ResponsesWS(client, {
            headers: this.websocketHeaders(),
        });
        if (!this.websocketStarted) {
            for await (const event of withCodexStreamIdleTimeout({
                stream: createCodexWebSocketStream({
                    client,
                    request: createCodexCliWarmupRequest(request, tools),
                    socket: this.socket,
                    ...(signal === undefined ? {} : { signal }),
                    ...(this.turnState === undefined ? {} : { turnState: this.turnState }),
                }),
                timeoutMs: this.streamIdleTimeoutMs,
                ...(signal === undefined ? {} : { signal }),
                onTimeout: () => this.closeSocket("stream idle timeout"),
            })) {
                this.observeTurnState(event);
                if (event.type === "response.completed")
                    this.previousResponseId = event.response.id;
            }
            this.websocketStarted = true;
        }
        const fullRequest = request;
        const incrementalInput =
            this.previousRequest === undefined
                ? undefined
                : getCodexIncrementalInput(
                      this.previousRequest,
                      this.previousResponseItems,
                      fullRequest,
                  );
        const canContinue =
            !this.websocketNeedsFullRequest &&
            (!this.websocketInferenceStarted || incrementalInput !== undefined);
        const inferenceRequest = canContinue
            ? createCodexCliWebSocketInferenceRequest(request)
            : createCodexCliSseRequest(request, tools);
        if (incrementalInput !== undefined) inferenceRequest.input = incrementalInput;
        if (canContinue && this.previousResponseId !== undefined) {
            inferenceRequest.previous_response_id = this.previousResponseId;
        }
        this.websocketInferenceStarted = true;
        this.websocketNeedsFullRequest = false;
        for await (const event of withCodexStreamIdleTimeout({
            stream: createCodexWebSocketStream({
                client,
                request: inferenceRequest,
                socket: this.socket,
                ...(signal === undefined ? {} : { signal }),
                ...(this.turnState === undefined ? {} : { turnState: this.turnState }),
            }),
            timeoutMs: this.streamIdleTimeoutMs,
            ...(signal === undefined ? {} : { signal }),
            onTimeout: () => this.closeSocket("stream idle timeout"),
        })) {
            this.observeTurnState(event);
            if (event.type === "response.completed") {
                this.previousResponseId = event.response.id;
                this.previousRequest = structuredClone(fullRequest);
                this.previousResponseItems = structuredClone(event.response.output ?? []);
            }
            yield event;
        }
    }

    private websocketHeaders(): Record<string, string> {
        const token =
            this.credential.name === "codex-session"
                ? this.credential.credential.accessToken
                : this.credential.name === "codex-api-key"
                  ? this.credential.credential.apiKey
                  : this.credential.credential.bearerToken;
        const accountId =
            this.credential.name === "codex-session"
                ? this.credential.credential.accountId
                : undefined;
        return {
            Authorization: `Bearer ${token}`,
            ...(accountId === undefined ? {} : { "chatgpt-account-id": accountId }),
            originator: "codex_exec",
            "OpenAI-Beta": "responses_websockets=2026-02-06",
            "session-id": this.id,
            "thread-id": this.id,
            "x-client-request-id": this.id,
            "x-codex-beta-features": "remote_compaction_v2",
            "x-codex-installation-id": this.installationId,
            "x-codex-window-id": this.windowId,
        };
    }

    private observeTurnState(event: ResponseStreamEvent): void {
        this.turnState ??= readCodexTurnState(event);
    }

    private closeSocket(reason: string): void {
        if (this.socket?.socket.readyState !== undefined && this.socket.socket.readyState < 2)
            this.socket.close({ code: 1000, reason });
        this.socket = undefined;
    }

    private clearWebsocketResponseChain(): void {
        this.previousRequest = undefined;
        this.previousResponseId = undefined;
        this.previousResponseItems = [];
    }

    private resetWebsocketConnection(reason: string): void {
        this.websocketNeedsFullRequest = this.websocketStarted;
        this.closeSocket(reason);
        this.clearWebsocketResponseChain();
        this.websocketInferenceStarted = false;
    }
}

function cloneConfiguration(configuration: SessionModelConfiguration): SessionModelConfiguration {
    return {
        context: cloneContext(configuration.context),
        skills: [...(configuration.skills ?? [])],
        tools: [...(configuration.tools ?? [])],
    };
}

function cloneContext(context: SessionContext): SessionContext {
    return {
        instructions: context.instructions,
        messages: structuredClone(context.messages),
    };
}

function cancelledStream(): SessionStream {
    async function* stream(): AsyncGenerator<SessionEvent> {
        yield { type: "done", state: "cancelled" };
    }
    return stream();
}
