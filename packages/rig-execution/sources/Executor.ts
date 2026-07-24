import { release } from "node:os";

import {
    areProviderModelsCompatible,
    ClaudeProvider,
    type ClaudeAuxiliaryQueryRequest,
    type ClaudeAuxiliaryQueryResponse,
    type BaseProvider,
    type BaseSession,
    type SessionContext,
    type SessionModelConfiguration,
} from "@slopus/rig-providers";

import type { ExecutorEvent } from "@/ExecutorEvent.js";
import type {
    ExecutorModelProfile,
    ExecutorRunRequest,
    ExecutorSelection,
} from "@/ExecutorModelProfile.js";
import type { ExecutorProvider } from "@/ExecutorProvider.js";
import { DEFAULT_IDENTITY, type Identity } from "@/Identity.js";
import { createExecutorInferenceStream } from "@/createExecutorInferenceStream.js";
import { runProviderAuxiliaryText } from "@/runProviderAuxiliaryText.js";
import type { ExecutorEnvironment } from "@/prompts/ExecutorEnvironment.js";
import { assembleSystemPrompt } from "@/prompts/assembleSystemPrompt.js";
import type {
    Context,
    InferenceStream,
    Model,
    ProfileProviderType,
    ProfilePromptContext,
    ServiceTier,
    StreamOptions,
} from "@/types.js";

export class Executor {
    readonly environment: ExecutorEnvironment;
    readonly identity: Identity;
    readonly providers: readonly ExecutorProvider[];
    readonly profiles: readonly ExecutorModelProfile[];
    private selectedProviderId: string;
    private active:
        | {
              contextInstructions: string | undefined;
              context: SessionContext;
              profile: ExecutorModelProfile;
              session: BaseSession;
              systemPrompt: string | undefined;
              toolsKey: string;
          }
        | undefined;
    private readonly profilesByKey = new Map<string, ExecutorModelProfile>();
    private readonly providersById = new Map<string, ExecutorProvider>();
    private readonly nativeProviders = new Map<string, Promise<BaseProvider>>();
    private inferencePending: Promise<void> = Promise.resolve();
    private sessionResolutionPending: Promise<void> = Promise.resolve();
    private sessionSequence = 0;

    constructor(
        providers: readonly ExecutorProvider[],
        options: { environment?: ExecutorEnvironment; identity?: Identity } = {},
    ) {
        this.environment = options.environment ?? {
            osVersion: release(),
            platform: process.platform,
            primaryWorkingDirectory: process.cwd(),
            shell: process.env.SHELL ?? "",
        };
        this.identity = { ...(options.identity ?? DEFAULT_IDENTITY) };
        this.providers = [...providers];
        for (const provider of providers) {
            if (this.providersById.has(provider.id)) {
                throw new Error(`Executor provider '${provider.id}' is configured more than once.`);
            }
            this.providersById.set(provider.id, provider);
            for (const profile of provider.profiles) {
                if (profile.providerId !== provider.id) {
                    throw new Error(
                        `Model '${profile.id}' belongs to '${profile.providerId}', not '${provider.id}'.`,
                    );
                }
                const key = selectionKey(profile);
                if (this.profilesByKey.has(key)) {
                    throw new Error(
                        `Executor model '${profile.id}' is configured more than once for '${provider.id}'.`,
                    );
                }
                this.profilesByKey.set(key, profile);
            }
        }
        this.profiles = [...this.profilesByKey.values()];
        const primary = providers[0];
        if (primary === undefined) throw new Error("Executor requires at least one provider.");
        this.selectedProviderId = primary.id;
    }

    get id(): string {
        return this.selectedProviderId;
    }

    get models(): readonly Model[] {
        return this.selectedProvider.profiles.map((profile) => profile.model);
    }

    get serviceTiers(): readonly ServiceTier[] | undefined {
        return this.selectedProvider.serviceTiers;
    }

    get type(): ProfileProviderType {
        const type = this.selectedProvider.profiles[0]?.providerType;
        if (type === undefined || type === "gym") {
            throw new Error(
                `Executor provider '${this.selectedProviderId}' has no concrete coding-model type.`,
            );
        }
        return type;
    }

    get extendProfilePromptContext():
        | ((context: ProfilePromptContext) => ProfilePromptContext | Promise<ProfilePromptContext>)
        | undefined {
        return this.selectedProvider.extendProfilePromptContext;
    }

    get quota(): ExecutorProvider["quota"] {
        return this.selectedProvider.quota;
    }

    get hasActiveSession(): boolean {
        return this.active !== undefined;
    }

    selectProvider(providerId: string): void {
        if (!this.providersById.has(providerId)) {
            throw new Error(`Executor provider '${providerId}' is not configured.`);
        }
        this.selectedProviderId = providerId;
    }

    async systemPrompt(
        selection: ExecutorSelection,
        contextInstructions?: string,
        systemPrompt?: string,
    ): Promise<string> {
        return assembleSystemPrompt({
            ...(contextInstructions === undefined ? {} : { contextInstructions }),
            environment: this.environment,
            identity: this.identity,
            profile: this.profile(selection),
            profiles: this.profiles,
            ...(systemPrompt === undefined ? {} : { systemPrompt }),
        });
    }

    stream(model: Model, context: Context, streamOptions?: StreamOptions): InferenceStream {
        const selection = { modelId: model.id, providerId: this.id };
        this.profile(selection);
        return createExecutorInferenceStream({
            context,
            executor: this,
            model,
            providerId: selection.providerId,
            ...(streamOptions === undefined ? {} : { streamOptions }),
        });
    }

    async runClaudeAuxiliaryQuery(
        model: Model,
        request: ClaudeAuxiliaryQueryRequest,
    ): Promise<ClaudeAuxiliaryQueryResponse> {
        const releaseInference = await this.acquireInference();
        try {
            const profile = this.profile({ modelId: model.id, providerId: this.id });
            const native = await this.resolveNative(this.selectedProvider, profile);
            if (!(native instanceof ClaudeProvider)) {
                if ((request.tools?.length ?? 0) > 0) {
                    throw new Error(
                        `The selected provider '${this.id}' does not support Claude web search.`,
                    );
                }
                return runProviderAuxiliaryText({
                    model: profile.id,
                    native,
                    request,
                });
            }
            return native.runAuxiliaryQuery(profile.id, request);
        } finally {
            releaseInference();
        }
    }

    async *run(request: ExecutorRunRequest): AsyncGenerator<ExecutorEvent> {
        const releaseInference = await this.acquireInference();
        try {
            const profile = this.profile(request.selection);
            const resolution = await this.serializeSessionResolution(async () => {
                if (
                    this.active !== undefined &&
                    !areProviderModelsCompatible(
                        toCompatibilitySelection(this.active.profile),
                        toCompatibilitySelection(profile),
                    )
                ) {
                    return {
                        type: "reset_required" as const,
                        current: toSelection(this.active.profile),
                        requested: request.selection,
                        message: `Reset the executor before switching from '${this.active.profile.id}' to incompatible model '${profile.id}'.`,
                    };
                }

                const tools = request.tools ?? [];
                const toolsKey = JSON.stringify(tools);
                const instructions = assembleSystemPrompt({
                    ...(request.contextInstructions === undefined
                        ? {}
                        : { contextInstructions: request.contextInstructions }),
                    environment: this.environment,
                    identity: this.identity,
                    profile,
                    profiles: this.profiles,
                    ...(request.systemPrompt === undefined
                        ? {}
                        : { systemPrompt: request.systemPrompt }),
                });
                const context = { ...request.context, instructions };
                const active = await this.resolveSession(
                    profile,
                    context,
                    request.contextInstructions,
                    request.systemPrompt,
                    tools,
                    toolsKey,
                );
                active.context = context;
                return active;
            });
            if ("type" in resolution) {
                yield resolution;
                return;
            }

            yield* resolution.session.run({
                ...(request.abort === undefined ? {} : { abort: request.abort }),
                context: { messages: request.context.messages },
                ...(request.effort === undefined ? {} : { effort: request.effort }),
                model: profile.id,
                ...(request.serviceTier === undefined ? {} : { serviceTier: request.serviceTier }),
            });
        } finally {
            releaseInference();
        }
    }

    async compact(options: { instructions?: string; signal?: AbortSignal } = {}) {
        const releaseInference = await this.acquireInference();
        try {
            if (this.active === undefined) throw new Error("Executor has no active session.");
            return this.active.session.compact({
                ...(options.instructions === undefined
                    ? {}
                    : { instructions: options.instructions }),
                ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
        } finally {
            releaseInference();
        }
    }

    async reset(selection?: ExecutorSelection): Promise<void> {
        if (selection !== undefined) this.profile(selection);
        const releaseInference = await this.acquireInference();
        try {
            await this.serializeSessionResolution(async () => {
                const active = this.active;
                this.active = undefined;
                if (active !== undefined) await active.session.destroy();
            });
        } finally {
            releaseInference();
        }
    }

    async destroy(): Promise<void> {
        try {
            await this.reset();
        } finally {
            await Promise.all(
                [...this.providersById.values()].map((provider) => provider.destroy?.()),
            );
        }
    }

    async close(): Promise<void> {
        await this.destroy();
    }

    private profile(selection: ExecutorSelection): ExecutorModelProfile {
        const profile = this.profilesByKey.get(selectionKey(selection));
        if (profile === undefined) {
            throw new Error(
                `Executor model '${selection.modelId}' is not available for provider '${selection.providerId}'.`,
            );
        }
        return profile;
    }

    private async resolveSession(
        profile: ExecutorModelProfile,
        context: SessionContext,
        contextInstructions: string | undefined,
        systemPrompt: string | undefined,
        tools: readonly import("@slopus/rig-providers").SessionTool[],
        toolsKey: string,
    ) {
        const provider = this.providersById.get(profile.providerId)!;
        if (
            this.active !== undefined &&
            this.active.profile.providerId === profile.providerId &&
            nativeKey(provider, this.active.profile) === nativeKey(provider, profile) &&
            this.active.contextInstructions === contextInstructions &&
            this.active.systemPrompt === systemPrompt &&
            this.active.toolsKey === toolsKey
        ) {
            this.active.profile = profile;
            return this.active;
        }
        const previous = this.active;
        this.active = undefined;
        if (previous !== undefined) await previous.session.destroy();
        const modelConfigurations: Record<string, SessionModelConfiguration> = {};
        for (const candidate of provider.profiles) {
            const instructions = assembleSystemPrompt({
                ...(contextInstructions === undefined ? {} : { contextInstructions }),
                environment: this.environment,
                identity: this.identity,
                profile: candidate,
                profiles: this.profiles,
                ...(systemPrompt === undefined ? {} : { systemPrompt }),
            });
            modelConfigurations[candidate.id] = {
                context: {
                    ...context,
                    instructions,
                },
                tools,
            };
        }
        const sequence = ++this.sessionSequence;
        const sessionId =
            provider.sessionId === undefined
                ? `executor-${String(sequence)}`
                : sequence === 1
                  ? provider.sessionId
                  : `${provider.sessionId}-reset-${String(sequence)}`;
        const native = await this.resolveNative(provider, profile);
        const session = await native.session(sessionId, {
            context,
            modelConfigurations,
            tools,
        });
        return (this.active = {
            context,
            contextInstructions,
            profile,
            session,
            systemPrompt,
            toolsKey,
        });
    }

    private async serializeSessionResolution<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.sessionResolutionPending;
        let release!: () => void;
        this.sessionResolutionPending = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }

    private async acquireInference(): Promise<() => void> {
        const previous = this.inferencePending;
        let release!: () => void;
        this.inferencePending = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        return release;
    }

    private resolveNative(
        provider: ExecutorProvider,
        profile: ExecutorModelProfile,
    ): Promise<BaseProvider> {
        const key = `${provider.id}\0${nativeKey(provider, profile)}`;
        const existing = this.nativeProviders.get(key);
        if (existing !== undefined) return existing;
        const pending =
            typeof provider.native === "function"
                ? provider.native(profile)
                : Promise.resolve(provider.native);
        this.nativeProviders.set(key, pending);
        void pending.catch(() => {
            if (this.nativeProviders.get(key) === pending) {
                this.nativeProviders.delete(key);
            }
        });
        return pending;
    }

    private get selectedProvider(): ExecutorProvider {
        return this.providersById.get(this.selectedProviderId)!;
    }
}

function nativeKey(provider: ExecutorProvider, profile: ExecutorModelProfile): string {
    return provider.nativeKey?.(profile) ?? provider.id;
}

function selectionKey(selection: ExecutorSelection | ExecutorModelProfile): string {
    const modelId = "modelId" in selection ? selection.modelId : selection.id;
    return `${selection.providerId}\0${modelId}`;
}

function toSelection(profile: ExecutorModelProfile): ExecutorSelection {
    return { modelId: profile.id, providerId: profile.providerId };
}

function toCompatibilitySelection(profile: ExecutorModelProfile) {
    return {
        modelId: profile.id,
        providerId: profile.providerId,
        providerType: profile.providerType,
    };
}
