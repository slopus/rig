import {
    createSubagentInstructions,
    findLastAgentResponseText,
    type ChatHistoryPage,
    selectChatHistoryPage,
    type ManagedSubagent,
    type SpawnSubagentRequest,
    type SpawnSubagentResult,
    type SubagentRunStatus,
    type WaitForSubagentResult,
} from "../agent/index.js";
import { DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS } from "../agent/context/subagentWaitTimeouts.js";
import type { CreateSessionRequest, SessionAgentMetadata } from "../protocol/index.js";
import type { Message } from "../agent/types.js";
import type { PermissionMode } from "../permissions/index.js";
import type { InMemorySession } from "./InMemorySession.js";
import type { TaskDrain } from "./TrackedTaskDrain.js";

export const DEFAULT_MAX_SUBAGENT_DEPTH = 3;
export const DEFAULT_MAX_ACTIVE_SUBAGENTS = 8;

export interface AgentSessionRepository {
    createSubagent(
        request: CreateSessionRequest,
        metadata: SessionAgentMetadata,
        contextMessages?: readonly Message[],
    ): InMemorySession;
    get(sessionId: string): InMemorySession | undefined;
    listByRoot(rootSessionId: string): readonly InMemorySession[];
}

export interface AgentSessionManagerOptions {
    maxActive?: number;
    maxDepth?: number;
    repository: AgentSessionRepository;
    taskDrain?: TaskDrain;
}

export class AgentSessionManager {
    readonly maxActive: number;
    readonly maxDepth: number;

    readonly #repository: AgentSessionRepository;
    readonly #latestBackgroundRunBySession = new Map<string, string>();
    readonly #pendingBackgroundRuns = new Map<string, string>();
    readonly #slotReservations = new Map<string, number>();
    readonly #stoppedExplicitly = new Set<string>();
    readonly #taskDrain: TaskDrain | undefined;

    constructor(options: AgentSessionManagerOptions) {
        this.#repository = options.repository;
        this.#taskDrain = options.taskDrain;
        this.maxActive = options.maxActive ?? DEFAULT_MAX_ACTIVE_SUBAGENTS;
        this.maxDepth = options.maxDepth ?? DEFAULT_MAX_SUBAGENT_DEPTH;
    }

    taskSession(sessionId: string): InMemorySession | undefined {
        const session = this.#repository.get(sessionId);
        if (session === undefined) return undefined;
        return this.#repository.get(session.agentMetadata().rootSessionId) ?? session;
    }

    recordChanged(child: InMemorySession): void {
        let parent = this.#parentFor(child);
        while (parent !== undefined) {
            parent.recordSubagentChanged(child.subagentSummary());
            parent = this.#parentFor(parent);
        }
    }

    async changeSubagentPermissionModes(
        parentSessionId: string,
        permissionMode: PermissionMode,
    ): Promise<void> {
        const root = this.#rootFor(parentSessionId);
        await Promise.all(
            this.#repository
                .listByRoot(root.id)
                .map((session) =>
                    session.changePermissionMode({ permissionMode }, { updateSubagents: false }),
                ),
        );
    }

    followUp(
        parentSessionId: string,
        target: string,
        message: string,
        effort?: string,
        encryptedMessage?: string,
    ): ManagedSubagent {
        const child = this.#resolveTarget(parentSessionId, target);
        const parent = this.#repository.get(parentSessionId);
        if (encryptedMessage !== undefined) {
            const parentTransportScope = parent?.encryptedAgentTransportScope();
            if (
                parentTransportScope === undefined ||
                parentTransportScope !== child.encryptedAgentTransportScope()
            ) {
                throw new Error(
                    "Native encrypted collaboration only works within the same compatible provider and region. Retry with `rig.followup_task` and provide the task normally.",
                );
            }
        }
        if (child.subagentSummary().status === "suspended") child.clearSuspension();
        this.#stoppedExplicitly.delete(child.id);
        const childPath = this.#pathFor(child);
        const parentPath = parent === undefined ? "/root" : this.#pathFor(parent);
        const submitted = child.submit({
            ...(this.#repository.get(parentSessionId)?.activeRunDebug?.() === true
                ? { debug: true }
                : {}),
            ...(effort === undefined ? {} : { effort }),
            ...(encryptedMessage === undefined
                ? {}
                : {
                      encryptedAgentMessage: {
                          author: parentPath,
                          recipient: childPath,
                          header: `Message Type: NEW_TASK\nTask name: ${childPath}\nSender: ${parentPath}\nPayload:\n`,
                          encryptedContent: encryptedMessage,
                      },
                      displayText: `Follow-up task for ${child.subagentSummary().taskName}`,
                  }),
            provenance: "agent",
            text: message,
        });
        const childParent = this.#parentFor(child);
        this.recordChanged(child);
        this.#startBackgroundMonitor(childParent, child, submitted.runId);
        return this.#managedSubagent(child);
    }

    sendMessage(
        parentSessionId: string,
        target: string,
        message: string,
        encryptedMessage?: string,
    ): ManagedSubagent {
        const child = this.#resolveTarget(parentSessionId, target);
        const parent = this.#repository.get(parentSessionId);
        if (encryptedMessage !== undefined) {
            const parentTransportScope = parent?.encryptedAgentTransportScope();
            if (
                parentTransportScope === undefined ||
                parentTransportScope !== child.encryptedAgentTransportScope()
            ) {
                throw new Error(
                    "Native encrypted collaboration only works within the same compatible provider and region.",
                );
            }
        }
        const childPath = this.#pathFor(child);
        const parentPath = parent === undefined ? "/root" : this.#pathFor(parent);
        child.deliverAgentMessage({
            blocks: message.length === 0 ? [] : [{ type: "text", text: message }],
            id: crypto.randomUUID(),
            provenance: "agent",
            role: "user",
            ...(encryptedMessage === undefined
                ? {}
                : {
                      encryptedAgentMessage: {
                          author: parentPath,
                          recipient: childPath,
                          header: `Message Type: MESSAGE\nTask name: ${childPath}\nSender: ${parentPath}\nPayload:\n`,
                          encryptedContent: encryptedMessage,
                      },
                  }),
        });
        this.recordChanged(child);
        return this.#managedSubagent(child);
    }

    interrupt(parentSessionId: string, target: string): ManagedSubagent {
        const child = this.#resolveTarget(parentSessionId, target);
        const previous = this.#managedSubagent(child);
        void this.stopDescendants(child.id);
        if (child.subagentSummary().status === "suspended") child.clearSuspension();
        void Promise.resolve(child.abort({ stopDescendants: false })).catch(() => undefined);
        this.recordChanged(child);
        return previous;
    }

    inspect(parentSessionId: string, target: string): ManagedSubagent {
        const child = this.#resolveTarget(parentSessionId, target);
        const agent = this.#managedSubagent(child);
        if (
            agent.status === "completed" ||
            agent.status === "error" ||
            agent.status === "aborted"
        ) {
            return {
                ...agent,
                output: this.#completionOutput(
                    child,
                    agent.status,
                    agent.status === "error" ? child.lastErrorMessage() : undefined,
                ),
            };
        }
        return agent;
    }

    async pauseDescendants(parentSessionId: string): Promise<number> {
        const parent = this.#repository.get(parentSessionId);
        if (parent === undefined) return 0;
        const active = this.#activeDescendantsOf(parentSessionId).filter(
            (child) => !this.#belongsToRunningWorkflow(child, parent),
        );
        await Promise.all(
            active.map(async (child) => {
                await child.suspendByParent();
                this.recordChanged(child);
            }),
        );
        parent.recordSubagentsSuspended(active.map((child) => this.#managedSubagent(child)));
        return active.length;
    }

    async stopDescendants(parentSessionId: string): Promise<number> {
        const descendants = this.#descendantsOf(parentSessionId);
        const active = descendants.filter((child) => {
            const status = child.subagentSummary().status;
            return status === "queued" || status === "running";
        });
        const suspended = descendants.filter(
            (child) => child.subagentSummary().status === "suspended",
        );
        for (const child of suspended) {
            child.clearSuspension();
            this.recordChanged(child);
        }
        for (const child of active) this.#stoppedExplicitly.add(child.id);
        await Promise.all(
            active.map(async (child) => {
                await child.abort({ stopDescendants: false });
                this.recordChanged(child);
            }),
        );
        return active.length + suspended.length;
    }

    list(parentSessionId: string, pathPrefix?: string): readonly ManagedSubagent[] {
        const root = this.#rootFor(parentSessionId);
        const agents = this.#repository
            .listByRoot(root.id)
            .filter((session) => session.isSubagent())
            .map((session) => this.#managedSubagent(session))
            .sort((left, right) => left.path.localeCompare(right.path));
        return pathPrefix === undefined
            ? agents
            : agents.filter((agent) => agent.path.startsWith(pathPrefix));
    }

    readChatHistory(
        currentSessionId: string,
        options: {
            cursor?: number;
            from?: "end" | "start";
            limit: number;
            query?: string;
            roles?: readonly ("assistant" | "system" | "user")[];
            target?: string;
        },
    ): ChatHistoryPage {
        const current = this.#repository.get(currentSessionId);
        if (current === undefined) throw new Error("The current session is no longer available.");
        const root = this.#rootFor(currentSessionId);
        const sessions = [root, ...this.#repository.listByRoot(root.id)];
        const target = (() => {
            if (options.target === undefined || options.target === "current") return current;
            const matches = sessions.filter((session) => {
                const metadata = session.agentMetadata();
                return (
                    session.id === options.target ||
                    metadata.taskName === options.target ||
                    this.#pathFor(session) === options.target
                );
            });
            if (matches.length === 0) {
                throw new Error(`Agent '${options.target}' was not found in this session tree.`);
            }
            if (matches.length > 1) {
                throw new Error(`Agent name '${options.target}' is ambiguous. Use its full path.`);
            }
            return matches[0] as InMemorySession;
        })();
        const agents = sessions
            .map((session) => {
                const snapshot = session.snapshot();
                return {
                    ...(snapshot.agent.description === undefined
                        ? {}
                        : { description: snapshot.agent.description }),
                    messageCount: snapshot.snapshot.messages.length,
                    path: this.#pathFor(session),
                    sessionId: session.id,
                    status: snapshot.status,
                };
            })
            .sort((left, right) => left.path.localeCompare(right.path));
        const messages = target.snapshot().snapshot.messages;
        return {
            agent: agents.find((agent) => agent.sessionId === target.id) as (typeof agents)[number],
            agents,
            ...selectChatHistoryPage(messages, options),
        };
    }

    hasActiveDescendantWork(rootSessionId: string): boolean {
        return this.#repository
            .listByRoot(rootSessionId)
            .some((session) => session.hasLocalSettlementWork());
    }

    recordDescendantSettlementActivity(rootSessionId: string): void {
        this.#repository.get(rootSessionId)?.recordDescendantActivity();
    }

    async spawn(
        parentSessionId: string,
        request: SpawnSubagentRequest,
        signal?: AbortSignal,
    ): Promise<SpawnSubagentResult> {
        const parent = this.#repository.get(parentSessionId);
        if (parent === undefined) {
            throw new Error("The parent session is no longer available.");
        }
        if (
            request.encryptedPrompt !== undefined &&
            (parent.encryptedAgentTransportScope() === undefined ||
                request.providerId !== undefined ||
                (request.modelId !== undefined && !request.modelId.startsWith("openai/gpt-5.6-")))
        ) {
            throw new Error(
                "Native encrypted collaboration only works within the current compatible provider and region. Use `rig.spawn_agent` and provide the task normally when selecting or crossing a model, provider, or region.",
            );
        }
        if (request.providerId !== undefined && request.modelId === undefined) {
            throw new Error("A subagent provider requires an explicit model.");
        }
        let parentRequest: CreateSessionRequest | undefined;
        let childProviderId = request.providerId;
        if (request.modelId !== undefined) {
            parentRequest = parent.requestForSubagent();
            if (
                childProviderId !== undefined &&
                !parent.hasModel(request.modelId, childProviderId)
            ) {
                throw new Error(
                    `Model '${request.modelId}' is not available for provider '${childProviderId}'.`,
                );
            }
            if (childProviderId === undefined) {
                const currentProviderId = parentRequest.providerId;
                if (
                    currentProviderId !== undefined &&
                    parent.hasModel(request.modelId, currentProviderId)
                ) {
                    childProviderId = currentProviderId;
                } else {
                    const matchingProviderIds = parent.providerIdsForModel(request.modelId);
                    if (matchingProviderIds.length === 0) {
                        throw new Error(`Model '${request.modelId}' is not available.`);
                    }
                    if (matchingProviderIds.length > 1) {
                        throw new Error(
                            `Provider is required for model '${request.modelId}' because it is available from multiple providers: ${matchingProviderIds.map((providerId) => `'${providerId}'`).join(", ")}.`,
                        );
                    }
                    childProviderId = matchingProviderIds[0];
                }
            }
        }
        if (request.effort !== undefined) {
            parentRequest ??= parent.requestForSubagent();
            const childModelId = request.modelId ?? parentRequest.modelId;
            const effectiveChildProviderId = childProviderId ?? parentRequest.providerId;
            if (childModelId === undefined || effectiveChildProviderId === undefined) {
                throw new Error("A subagent effort requires a resolved model and provider.");
            }
            const effortLevels = parent.effortLevelsForModel(
                childModelId,
                effectiveChildProviderId,
            );
            if (effortLevels === undefined || !effortLevels.includes(request.effort)) {
                const allowed = effortLevels?.join(", ") || "none";
                throw new Error(
                    `Model '${childModelId}' does not support '${request.effort}' effort. Allowed effort levels: ${allowed}.`,
                );
            }
        }

        const parentMetadata = parent.agentMetadata();
        const depth = parentMetadata.depth + 1;
        if (depth > this.maxDepth) {
            throw new Error(`Subagents are limited to ${this.maxDepth} nested levels.`);
        }
        const releaseSlot = await this.#reserveSlot(
            parentMetadata.rootSessionId,
            request.waitForSlot === true,
            signal,
        );
        let child: InMemorySession;
        let submitted: ReturnType<InMemorySession["submit"]>;
        let taskName: string;
        try {
            parentRequest ??= parent.requestForSubagent();
            taskName = this.#taskName(parent, request.taskName, request.description);
            const metadata: SessionAgentMetadata = {
                depth,
                description: request.description,
                parentSessionId,
                ...(request.parentToolCallId !== undefined
                    ? { parentToolCallId: request.parentToolCallId }
                    : {}),
                rootSessionId: parentMetadata.rootSessionId,
                taskName,
                type: "subagent",
            };
            const childModelId = request.modelId ?? parentRequest.modelId;
            const childRequest = {
                ...parentRequest,
                instructions: createSubagentInstructions(
                    parentRequest.instructions,
                    depth,
                    this.maxDepth,
                    childModelId,
                ),
                ...(request.effort === undefined ? {} : { effort: request.effort }),
                ...(request.modelId === undefined ? {} : { modelId: request.modelId }),
                ...(childProviderId === undefined ? {} : { providerId: childProviderId }),
                ...(request.serviceTier === undefined ? {} : { serviceTier: request.serviceTier }),
            };
            child =
                request.contextMode === "parent"
                    ? this.#repository.createSubagent(
                          childRequest,
                          metadata,
                          request.contextMessages,
                      )
                    : this.#repository.createSubagent(childRequest, metadata);
            const childPath = this.#pathFor(child);
            const parentPath = this.#pathFor(parent);
            submitted = child.submit({
                ...(parent.activeRunDebug?.() === true ? { debug: true } : {}),
                ...(request.encryptedPrompt === undefined
                    ? {}
                    : {
                          encryptedAgentMessage: {
                              author: parentPath,
                              recipient: childPath,
                              header: `Message Type: NEW_TASK\nTask name: ${childPath}\nSender: ${parentPath}\nPayload:\n`,
                              encryptedContent: request.encryptedPrompt,
                          },
                          displayText: `Delegated task ${taskName}`,
                      }),
                provenance: "agent",
                text: request.prompt,
            });
            this.recordChanged(child);
        } finally {
            releaseSlot();
        }

        if (request.background === true) {
            this.#startBackgroundMonitor(parent, child, submitted.runId);
            return {
                output: "The subagent is running in the background.",
                path: this.#pathFor(child),
                sessionId: child.id,
                status: "running",
                taskName,
            };
        }

        const abortChild = () => void Promise.resolve(child.abort()).catch(() => undefined);
        signal?.addEventListener("abort", abortChild, { once: true });

        try {
            if (signal?.aborted) {
                void Promise.resolve(child.abort()).catch(() => undefined);
            }
            const completion = await child.waitForRun(submitted.runId);
            this.recordChanged(child);
            return {
                output: this.#completionOutput(child, completion.status, completion.errorMessage),
                path: this.#pathFor(child),
                sessionId: child.id,
                status: completion.status,
                taskName,
            };
        } catch (error) {
            void Promise.resolve(child.abort()).catch(() => undefined);
            throw error;
        } finally {
            signal?.removeEventListener("abort", abortChild);
            this.#stoppedExplicitly.delete(child.id);
        }
    }

    async #reserveSlot(
        rootSessionId: string,
        waitForSlot: boolean,
        signal?: AbortSignal,
    ): Promise<() => void> {
        for (;;) {
            if (signal?.aborted) throw new Error("Waiting for a subagent slot was cancelled.");
            const active = this.#repository.listByRoot(rootSessionId).filter((session) => {
                const status = session.subagentSummary().status;
                return status === "queued" || status === "running";
            }).length;
            const reserved = this.#slotReservations.get(rootSessionId) ?? 0;
            if (active + reserved < this.maxActive) {
                this.#slotReservations.set(rootSessionId, reserved + 1);
                let released = false;
                return () => {
                    if (released) return;
                    released = true;
                    const current = this.#slotReservations.get(rootSessionId) ?? 1;
                    if (current <= 1) this.#slotReservations.delete(rootSessionId);
                    else this.#slotReservations.set(rootSessionId, current - 1);
                };
            }
            if (!waitForSlot) {
                throw new Error(`No more than ${this.maxActive} subagents can run at once.`);
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    #activeDescendantsOf(parentSessionId: string): readonly InMemorySession[] {
        return this.#descendantsOf(parentSessionId).filter((session) => {
            const status = session.subagentSummary().status;
            return status === "queued" || status === "running";
        });
    }

    #belongsToRunningWorkflow(child: InMemorySession, parent: InMemorySession): boolean {
        let current: InMemorySession | undefined = child;
        while (current !== undefined && current.id !== parent.id) {
            const taskName = current.agentMetadata().taskName;
            const workflowRunId =
                taskName === undefined ? undefined : /^workflow_(.+)_\d+$/u.exec(taskName)?.[1];
            if (
                workflowRunId !== undefined &&
                parent.getWorkflow(workflowRunId)?.status === "running"
            ) {
                return true;
            }
            const parentSessionId: string | undefined = current.agentMetadata().parentSessionId;
            current =
                parentSessionId === undefined ? undefined : this.#repository.get(parentSessionId);
        }
        return false;
    }

    async wait(
        parentSessionId: string,
        timeoutMs = DEFAULT_SUBAGENT_WAIT_TIMEOUT_MS,
        signal?: AbortSignal,
    ): Promise<WaitForSubagentResult> {
        const initial = this.list(parentSessionId);
        const running = initial.filter((agent) => agent.status === "running");
        const terminal = initial.filter((agent) => agent.status !== "running");
        if (running.length === 0) {
            return { agents: terminal, timedOut: false };
        }

        const runningSessionIds = new Set(running.map((agent) => agent.sessionId));
        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (Date.now() < deadline) {
            if (signal?.aborted) throw new Error("Waiting for subagents was cancelled.");
            await new Promise((resolve) =>
                setTimeout(resolve, Math.min(100, deadline - Date.now())),
            );
            const current = this.list(parentSessionId);
            const changed = current.filter(
                (agent) => runningSessionIds.has(agent.sessionId) && agent.status !== "running",
            );
            if (changed.length > 0) return { agents: changed, timedOut: false };
        }
        return { agents: [], timedOut: true };
    }

    #completionOutput(
        child: InMemorySession,
        status: Exclude<SubagentRunStatus, "running">,
        errorMessage?: string,
    ): string {
        return (
            (status === "error" ? errorMessage : undefined) ??
            findLastAgentResponseText(child.snapshot().snapshot.messages) ??
            (status === "aborted"
                ? "The subagent was stopped before it returned a response."
                : "The subagent finished without a text response.")
        );
    }

    #managedSubagent(child: InMemorySession): ManagedSubagent {
        const summary = child.subagentSummary();
        return {
            description: summary.description,
            path: this.#pathFor(child),
            sessionId: child.id,
            status: this.#runStatus(summary.status),
            taskName: child.agentMetadata().taskName ?? child.id,
        };
    }

    async #monitorBackground(
        parent: InMemorySession | undefined,
        child: InMemorySession,
        runId: string,
    ): Promise<void> {
        const monitorId = `${child.id}:${runId}`;
        this.#latestBackgroundRunBySession.set(child.id, runId);
        this.#pendingBackgroundRuns.set(monitorId, child.id);
        try {
            const completion = await child.waitForRun(runId);
            this.recordChanged(child);
            if (completion.status === "aborted" && child.consumeSuspendedRun(runId)) return;
            const status = await this.#waitForSettledSubtree(child);
            this.recordChanged(child);
            if (status === "suspended") return;
            if (this.#stoppedExplicitly.delete(child.id)) return;
            if (parent === undefined || parent.isClosing?.() === true) return;
            if (this.#latestBackgroundRunBySession.get(child.id) !== runId) return;
            const output = this.#completionOutput(
                child,
                status,
                status === completion.status ? completion.errorMessage : undefined,
            );
            const taskName = child.agentMetadata().taskName ?? child.id;
            const description = child.subagentSummary().description;
            const outcome =
                status === "completed"
                    ? "completed"
                    : status === "aborted"
                      ? "was stopped"
                      : "failed";
            parent.deliverNotification({
                displayText: `Background work "${description}" ${outcome}.`,
                text: [
                    "<subagent-notification>",
                    `Task: ${taskName}`,
                    `Status: ${status}`,
                    `Result: ${output}`,
                    "</subagent-notification>",
                ].join("\n"),
            });
        } catch {
            this.recordChanged(child);
        } finally {
            this.#pendingBackgroundRuns.delete(monitorId);
            if (this.#latestBackgroundRunBySession.get(child.id) === runId) {
                this.#latestBackgroundRunBySession.delete(child.id);
            }
        }
    }

    async #waitForSettledSubtree(
        child: InMemorySession,
    ): Promise<Exclude<SubagentRunStatus, "running">> {
        for (;;) {
            const status = this.#runStatus(child.subagentSummary().status);
            const descendants = this.#descendantsOf(child.id);
            const descendantIds = new Set(descendants.map((descendant) => descendant.id));
            const unsettledDescendant = descendants.some((descendant) => {
                const descendantStatus = descendant.subagentSummary().status;
                return (
                    descendantStatus === "suspended" ||
                    this.#runStatus(descendantStatus) === "running"
                );
            });
            const pendingDescendant = [...this.#pendingBackgroundRuns.values()].some((sessionId) =>
                descendantIds.has(sessionId),
            );
            if (status !== "running" && !unsettledDescendant && !pendingDescendant) return status;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    #startBackgroundMonitor(
        parent: InMemorySession | undefined,
        child: InMemorySession,
        runId: string,
    ): void {
        const monitor = () => this.#monitorBackground(parent, child, runId);
        const task = this.#taskDrain?.run(monitor) ?? monitor();
        void task.catch(() => undefined);
    }

    #parentFor(child: InMemorySession): InMemorySession | undefined {
        const parentSessionId = child.agentMetadata().parentSessionId;
        return parentSessionId === undefined ? undefined : this.#repository.get(parentSessionId);
    }

    #descendantsOf(parentSessionId: string): readonly InMemorySession[] {
        const parent = this.#repository.get(parentSessionId);
        if (parent === undefined) return [];
        return this.#repository
            .listByRoot(parent.agentMetadata().rootSessionId)
            .filter((session) => this.#isDescendantOf(session, parentSessionId));
    }

    #isDescendantOf(session: InMemorySession, parentSessionId: string): boolean {
        let currentParentId = session.agentMetadata().parentSessionId;
        while (currentParentId !== undefined) {
            if (currentParentId === parentSessionId) return true;
            currentParentId = this.#repository
                .get(currentParentId)
                ?.agentMetadata().parentSessionId;
        }
        return false;
    }

    #pathFor(child: InMemorySession): string {
        const names: string[] = [];
        let current: InMemorySession | undefined = child;
        while (current !== undefined && current.isSubagent()) {
            const metadata = current.agentMetadata();
            names.unshift(metadata.taskName ?? current.id);
            current =
                metadata.parentSessionId === undefined
                    ? undefined
                    : this.#repository.get(metadata.parentSessionId);
        }
        return names.length === 0 ? "/root" : `/root/${names.join("/")}`;
    }

    #resolveTarget(parentSessionId: string, target: string): InMemorySession {
        const root = this.#rootFor(parentSessionId);
        const matches = this.#repository.listByRoot(root.id).filter((session) => {
            if (!session.isSubagent()) return false;
            const metadata = session.agentMetadata();
            return (
                session.id === target ||
                metadata.taskName === target ||
                this.#pathFor(session) === target
            );
        });
        if (matches.length === 0) throw new Error(`Subagent '${target}' was not found.`);
        if (matches.length > 1) {
            throw new Error(`Subagent name '${target}' is ambiguous. Use its full task path.`);
        }
        return matches[0] as InMemorySession;
    }

    #rootFor(sessionId: string): InMemorySession {
        const session = this.#repository.get(sessionId);
        if (session === undefined) throw new Error("The current session is no longer available.");
        return this.#repository.get(session.agentMetadata().rootSessionId) ?? session;
    }

    #runStatus(
        status: ReturnType<InMemorySession["subagentSummary"]>["status"],
    ): SubagentRunStatus {
        if (
            status === "aborted" ||
            status === "error" ||
            status === "completed" ||
            status === "suspended"
        ) {
            return status;
        }
        return "running";
    }

    #taskName(parent: InMemorySession, requested: string | undefined, description: string): string {
        if (requested !== undefined && !/^[a-z0-9_]+$/u.test(requested)) {
            throw new Error(
                "Task names may contain only lowercase letters, numbers, and underscores.",
            );
        }
        const root = this.#rootFor(parent.id);
        const existing = new Set(
            this.#repository
                .listByRoot(root.id)
                .map((session) => session.agentMetadata().taskName)
                .filter((name): name is string => name !== undefined),
        );
        if (requested !== undefined) {
            if (existing.has(requested)) {
                throw new Error(`A subagent named '${requested}' already exists in this session.`);
            }
            return requested;
        }

        const normalized = description
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, "_")
            .replace(/^_+|_+$/gu, "")
            .slice(0, 32);
        const base = normalized.length > 0 ? normalized : "task";
        let candidate = base;
        let suffix = 2;
        while (existing.has(candidate)) {
            candidate = `${base}_${suffix}`;
            suffix += 1;
        }
        return candidate;
    }
}
