import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type {
    AbortRunResponse,
    AnswerUserInputRequest,
    AttachSecretRequest,
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangePermissionModeRequest,
    ChangeServiceTierRequest,
    ChangeSessionGoalStatusRequest,
    CompactSessionResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    DaemonIdentity,
    ForkSessionResponse,
    GetCurrentProviderQuotaResponse,
    GetDaemonConfigResponse,
    GetSessionUsageResponse,
    ListGlobalEventsResponse,
    ListSecretsResponse,
    HealthResponse,
    GoalSessionResponse,
    ListModelsResponse,
    ListSessionsResponse,
    ListSubagentsResponse,
    ModelCatalog,
    RewindSessionRequest,
    RewindSessionResponse,
    RecordSessionActivityResponse,
    RegisterSecretRequest,
    RegisterSecretResponse,
    SearchFilesResponse,
    SecretSessionResponse,
    SessionEvent,
    SetGoalRequest,
    ShutdownServerResponse,
    SteerMessageResponse,
    StopWorkflowResponse,
    SubmitMessageResponse,
    TrimGlobalEventsRequest,
    TrimGlobalEventsResponse,
    UnregisterSecretResponse,
    UpdateDaemonConfigRequest,
    UpdateDaemonConfigResponse,
} from "../protocol/index.js";
import { getDaemonIdentity } from "../daemon/index.js";
import { errorToMessage } from "../errorToMessage.js";
import { InMemorySessionStore } from "./InMemorySessionStore.js";
import { latestObservedProviderQuotas } from "./latestObservedProviderQuotas.js";
import { createModelCatalog } from "./createModelCatalog.js";
import { FileSearchService, type FileSearchServiceContract } from "./FileSearchService.js";
import type { SessionEventLog } from "./SessionEventLog.js";
import { isTransientInferenceSessionEvent } from "./isTransientInferenceSessionEvent.js";
import { isSubmitMessageRequest } from "./isSubmitMessageRequest.js";
import type { GlobalEventQueue } from "./GlobalEventQueue.js";
import type { SessionStore } from "./SessionStore.js";
import { isGlobalEventRoute } from "./isGlobalEventRoute.js";
import { parseGlobalEventCursor } from "./parseGlobalEventCursor.js";
import { parseGlobalEventLimit } from "./parseGlobalEventLimit.js";
import { sendJson } from "./sendJson.js";
import { streamGlobalEvents } from "./streamGlobalEvents.js";
import { INVALID_PERMISSION_MODE_MESSAGE, isPermissionMode } from "../permissions/index.js";
import { isGoalStatus } from "../goals/index.js";
import { resolveDockerExecutionConfig, validateDockerExecutionConfig } from "../execution/index.js";
import type { DockerExecutionConfig } from "../execution/index.js";
import type { TaskDrain } from "./TrackedTaskDrain.js";
import type { ProviderQuota } from "../providers/providerQuota.js";
import type { SecretRegistration } from "../secrets/index.js";

export interface ProtocolHttpServerOptions {
    defaultDocker?: DockerExecutionConfig;
    identity?: DaemonIdentity;
    initialization?: Promise<ModelCatalog>;
    modelCatalog?: ModelCatalog;
    fileSearchService?: FileSearchServiceContract;
    globalEventQueue?: GlobalEventQueue;
    getProviderQuota?: (providerId: string) => Promise<ProviderQuota | undefined>;
    onDurableGlobalEventQueueChange?: (
        enabled: boolean,
    ) => GlobalEventQueue | undefined | Promise<GlobalEventQueue | undefined>;
    onShutdown?: () => void;
    store?: SessionStore;
    taskDrain?: TaskDrain;
    secrets?: readonly SecretRegistration[];
    token: string;
}

export function createProtocolHttpServer(options: ProtocolHttpServerOptions): Server {
    const modelCatalog = options.modelCatalog ?? createModelCatalog();
    const store =
        options.store ??
        new InMemorySessionStore({
            modelCatalog,
            ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
        });
    const state = createInitializationState({ ...options, modelCatalog });
    const fileSearchService = options.fileSearchService ?? new FileSearchService();
    const runtimeConfig: ProtocolServerRuntimeConfig = {
        globalEventQueue: options.globalEventQueue,
        onDurableGlobalEventQueueChange: options.onDurableGlobalEventQueueChange,
    };

    const server = createServer((request, response) => {
        const mutating = isMutatingProtocolRequest(request);
        if (mutating && options.taskDrain?.closing === true) {
            sendJson(response, 503, { error: "The local daemon is shutting down." });
            return;
        }
        const handle = () =>
            handleRequest(
                request,
                response,
                store,
                state,
                fileSearchService,
                runtimeConfig,
                options.token,
                options.onShutdown,
                options.defaultDocker,
                options.taskDrain,
                options.getProviderQuota,
            );
        const handling =
            mutating && options.taskDrain !== undefined ? options.taskDrain.run(handle) : handle();
        void handling.catch((error: unknown) => {
            const invalidJson = error instanceof InvalidJsonBodyError;
            const status = invalidJson
                ? 400
                : mutating && options.taskDrain?.closing === true
                  ? 503
                  : 500;
            sendJson(response, status, {
                error: invalidJson ? "Request body must be valid JSON." : errorToMessage(error),
            });
        });
    });
    server.once("close", () => fileSearchService.close());
    return server;
}

interface InitializationState {
    catalog: ModelCatalog | undefined;
    errorMessage: string | undefined;
    identity: DaemonIdentity;
    ready: boolean;
}

interface ProtocolServerRuntimeConfig {
    globalEventQueue: GlobalEventQueue | undefined;
    onDurableGlobalEventQueueChange:
        | ((
              enabled: boolean,
          ) => GlobalEventQueue | undefined | Promise<GlobalEventQueue | undefined>)
        | undefined;
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    store: SessionStore,
    initialization: InitializationState,
    fileSearchService: FileSearchServiceContract,
    runtimeConfig: ProtocolServerRuntimeConfig,
    token: string,
    onShutdown: (() => void) | undefined,
    defaultDocker: DockerExecutionConfig | undefined,
    taskDrain: TaskDrain | undefined,
    getProviderQuota: ((providerId: string) => Promise<ProviderQuota | undefined>) | undefined,
): Promise<void> {
    if (!isAuthorized(request, token)) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
    }

    const url = new URL(request.url ?? "/", "http://unix");
    const route = matchRoute(url.pathname);
    if (route === undefined) {
        sendJson(response, 404, { error: "Not found" });
        return;
    }

    if (request.method === "GET" && route.name === "health") {
        sendJson<HealthResponse>(
            response,
            200,
            healthResponse(initialization, runtimeConfig.globalEventQueue !== undefined),
        );
        return;
    }

    if (request.method === "POST" && route.name === "shutdown") {
        taskDrain?.beginClose();
        sendJson<ShutdownServerResponse>(response, 202, {
            pid: process.pid,
            shuttingDown: true,
        });
        setImmediate(() => onShutdown?.());
        return;
    }

    if (!initialization.ready || initialization.catalog === undefined) {
        sendJson(
            response,
            503,
            healthResponse(initialization, runtimeConfig.globalEventQueue !== undefined),
        );
        return;
    }

    if (request.method === "GET" && route.name === "models") {
        sendJson<ListModelsResponse>(response, 200, { catalog: initialization.catalog });
        return;
    }

    if (request.method === "GET" && route.name === "config") {
        sendJson<GetDaemonConfigResponse>(response, 200, {
            config: {
                settings: {
                    durableGlobalEventQueue: runtimeConfig.globalEventQueue !== undefined,
                },
            },
        });
        return;
    }

    if (request.method === "PATCH" && route.name === "config") {
        const body = await readJson<UpdateDaemonConfigRequest>(request);
        const enabled = body.settings?.durableGlobalEventQueue;
        if (typeof enabled !== "boolean") {
            sendJson(response, 400, {
                error: "Durable global event queue must be enabled or disabled.",
            });
            return;
        }
        if (runtimeConfig.onDurableGlobalEventQueueChange === undefined) {
            sendJson(response, 409, {
                error: "This daemon cannot change the durable global event queue at runtime.",
            });
            return;
        }
        const queue = await runtimeConfig.onDurableGlobalEventQueueChange(enabled);
        if ((queue !== undefined) !== enabled) {
            throw new Error("The daemon could not apply the durable global event queue setting.");
        }
        runtimeConfig.globalEventQueue = queue;
        sendJson<UpdateDaemonConfigResponse>(response, 200, {
            config: { settings: { durableGlobalEventQueue: enabled } },
        });
        return;
    }

    if (isGlobalEventRoute(route.name)) {
        const globalEventQueue = runtimeConfig.globalEventQueue;
        if (globalEventQueue === undefined) {
            sendJson(response, 404, { error: "The durable global event queue is disabled." });
            return;
        }

        if (request.method === "GET" && route.name === "global-events") {
            const after = parseGlobalEventCursor(url.searchParams.get("after"));
            if (url.searchParams.has("after") && after === undefined) {
                sendJson(response, 400, { error: "The event cursor must be a whole number." });
                return;
            }
            const limit = parseGlobalEventLimit(url.searchParams.get("limit"));
            if (url.searchParams.has("limit") && limit === undefined) {
                sendJson(response, 400, { error: "The event limit must be a positive number." });
                return;
            }
            const events = globalEventQueue.list({
                ...(after === undefined ? {} : { after }),
                limit: limit ?? 100,
            });
            if (events === undefined) {
                sendJson(response, 409, { error: "The global event cursor is not available." });
                return;
            }
            sendJson<ListGlobalEventsResponse>(response, 200, { events });
            return;
        }

        if (request.method === "GET" && route.name === "global-events-stream") {
            streamGlobalEvents(request, response, globalEventQueue, url.searchParams.get("after"));
            return;
        }

        if (request.method === "POST" && route.name === "global-events-trim") {
            const body = await readJson<TrimGlobalEventsRequest>(request);
            if (!Number.isSafeInteger(body.through) || body.through < 0) {
                sendJson(response, 400, { error: "The trim cursor must be a whole number." });
                return;
            }
            const result = globalEventQueue.trim(body.through);
            if (result === undefined) {
                sendJson(response, 409, { error: "The global event cursor is not available." });
                return;
            }
            sendJson<TrimGlobalEventsResponse>(response, 200, result);
            return;
        }

        sendJson(response, 405, { error: "Method not allowed" });
        return;
    }

    if (request.method === "GET" && route.name === "secret-registrations") {
        sendJson<ListSecretsResponse>(response, 200, { secrets: store.listSecrets() });
        return;
    }

    if (request.method === "POST" && route.name === "secret-registrations") {
        const body = await readJson<unknown>(request);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
            sendJson(response, 400, { error: "Secret settings must be a JSON object." });
            return;
        }
        try {
            sendJson<RegisterSecretResponse>(response, 200, {
                secret: store.registerSecret(body as RegisterSecretRequest),
            });
        } catch (error) {
            sendJson(response, 400, {
                error: error instanceof Error ? error.message : "The secret could not be saved.",
            });
        }
        return;
    }

    if (request.method === "DELETE" && route.name === "secret-registration") {
        sendJson<UnregisterSecretResponse>(response, 200, {
            removed: store.unregisterSecret(route.secretId),
        });
        return;
    }

    if (request.method === "POST" && route.name === "sessions") {
        const body = await readJson<CreateSessionRequest | null>(request);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
            sendJson(response, 400, { error: "Session settings must be a JSON object." });
            return;
        }
        if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
            sendJson(response, 400, {
                error: INVALID_PERMISSION_MODE_MESSAGE,
            });
            return;
        }
        if (
            body.secretIds !== undefined &&
            (!Array.isArray(body.secretIds) ||
                body.secretIds.some((secretId) => typeof secretId !== "string"))
        ) {
            sendJson(response, 400, {
                error: "Secret IDs must be provided as a list of text IDs.",
            });
            return;
        }
        const { local, ...sessionRequest } = body;
        if (local === true && body.docker !== undefined) {
            sendJson(response, 400, {
                error: "Choose either local execution or a Docker environment, not both.",
            });
            return;
        }
        const configuredDocker =
            local === true || body.docker !== undefined ? undefined : defaultDocker;
        const docker = body.docker ?? configuredDocker;
        if (docker !== undefined) {
            try {
                validateDockerExecutionConfig(docker);
            } catch (error) {
                sendJson(response, 400, {
                    error: errorToMessage(error),
                });
                return;
            }
            sessionRequest.docker = resolveDockerExecutionConfig(docker, body.cwd);
        }
        try {
            const session = store.create(sessionRequest);
            sendJson<CreateSessionResponse>(response, 201, { session: session.snapshot() });
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The session could not be created.",
            });
        }
        return;
    }

    if (request.method === "GET" && route.name === "sessions") {
        const limit = parseLimit(url.searchParams.get("limit"));
        sendJson<ListSessionsResponse>(response, 200, {
            sessions: limit === undefined ? store.list() : store.list({ limit }),
        });
        return;
    }

    const sessionId = route.sessionId;
    if (sessionId === undefined) {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
    }

    const session = store.get(sessionId);
    if (session === undefined) {
        sendJson(response, 404, { error: "Session not found" });
        return;
    }

    if (request.method === "GET" && route.name === "session") {
        sendJson(response, 200, { session: session.snapshot() });
        return;
    }

    if (request.method === "GET" && route.name === "current-provider-quota") {
        const currentProviderId = session.snapshot().providerId;
        const quota = await getProviderQuota?.(currentProviderId);
        sendJson<GetCurrentProviderQuotaResponse>(response, 200, {
            currentProviderId,
            ...(quota === undefined ? {} : { quota }),
        });
        return;
    }

    if (request.method === "GET" && route.name === "usage") {
        const usage = session.usage();
        const currentProviderId = session.snapshot().providerId;
        const providerIds = [
            ...new Set([
                ...usage.groups.flatMap((group) =>
                    group.providerId === null ? [] : [group.providerId],
                ),
                ...usage.observedQuota.map((contribution) => contribution.providerId),
                currentProviderId,
            ]),
        ];
        const observedQuotas = latestObservedProviderQuotas(session.events.since(undefined) ?? []);
        const quotas = (
            await Promise.all(
                providerIds.map(async (providerId) => {
                    const loadedQuota =
                        getProviderQuota === undefined
                            ? providerId === currentProviderId
                                ? await session.providerQuota()
                                : undefined
                            : await getProviderQuota(providerId);
                    const observedQuota = observedQuotas.get(providerId);
                    const quota =
                        observedQuota !== undefined &&
                        (loadedQuota === undefined ||
                            observedQuota.capturedAt >= loadedQuota.capturedAt)
                            ? observedQuota
                            : loadedQuota;
                    return quota === undefined ? undefined : { providerId, quota };
                }),
            )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
        sendJson<GetSessionUsageResponse>(response, 200, {
            currentProviderId,
            groups: usage.groups,
            observedQuota: usage.observedQuota,
            quotas,
            ...(usage.currentContext === undefined ? {} : { context: usage.currentContext }),
        });
        return;
    }

    if (request.method === "GET" && route.name === "subagents") {
        sendJson<ListSubagentsResponse>(response, 200, {
            subagents: store.listSubagents(sessionId),
        });
        return;
    }

    if (request.method === "POST" && route.name === "workflow-stop") {
        const workflow = session.stopWorkflow(route.workflowRunId);
        if (workflow === undefined) {
            sendJson(response, 404, { error: "Workflow not found" });
            return;
        }
        sendJson<StopWorkflowResponse>(response, 200, { workflow });
        return;
    }

    if (request.method === "GET" && route.name === "files") {
        const query = (url.searchParams.get("query") ?? "").slice(0, 512);
        const files = await fileSearchService.search(
            session.snapshot().cwd,
            query,
            parseFileSearchLimit(url.searchParams.get("limit")),
        );
        sendJson<SearchFilesResponse>(response, 200, { files });
        return;
    }

    if (request.method === "POST" && route.name === "fork") {
        if (session.isSubagent()) {
            sendJson(response, 409, { error: "Subagent histories cannot be forked." });
            return;
        }
        try {
            const forked = store.fork(sessionId);
            if (forked === undefined) {
                sendJson(response, 404, { error: "Session not found" });
                return;
            }
            sendJson<ForkSessionResponse>(response, 201, { session: forked.snapshot() });
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The session could not be forked.",
            });
        }
        return;
    }

    if (session.isSubagent() && isSessionMutation(route.name, request.method)) {
        sendJson(response, 409, {
            error: "Subagent histories are read-only and cannot be resumed.",
        });
        return;
    }

    if (request.method === "POST" && route.name === "messages") {
        const body = await readJson<unknown>(request);
        if (!isSubmitMessageRequest(body)) {
            sendJson(response, 400, { error: "Message text must be text." });
            return;
        }
        sendJson<SubmitMessageResponse>(response, 202, session.submit(body));
        return;
    }

    if (request.method === "POST" && route.name === "activity") {
        session.recordUserActivity();
        sendJson<RecordSessionActivityResponse>(response, 200, { recorded: true });
        return;
    }

    if (request.method === "POST" && route.name === "steer") {
        const body = await readJson<unknown>(request);
        if (!isSubmitMessageRequest(body)) {
            sendJson(response, 400, { error: "Message text must be text." });
            return;
        }
        try {
            sendJson<SteerMessageResponse>(response, 202, session.steer(body));
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The active run cannot be steered.",
            });
        }
        return;
    }

    if (request.method === "POST" && route.name === "abort") {
        try {
            const expectedRunId = url.searchParams.get("expectedRunId") ?? undefined;
            const steeringMessageIds = url.searchParams.getAll("steeringMessageId");
            sendJson<AbortRunResponse>(
                response,
                200,
                await session.abort({
                    continuePendingSteering:
                        url.searchParams.get("continuePendingSteering") === "1",
                    ...(expectedRunId === undefined ? {} : { expectedRunId }),
                    ...(steeringMessageIds.length === 0 ? {} : { steeringMessageIds }),
                }),
            );
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The run could not be aborted.",
            });
        }
        return;
    }

    if (request.method === "POST" && route.name === "background-processes-stop") {
        const stoppedProcesses = await session.stopBackgroundProcesses();
        sendJson(response, 200, { stoppedProcesses });
        return;
    }

    if (request.method === "POST" && route.name === "reset") {
        sendJson(response, 200, { session: await session.reset() });
        return;
    }

    if (request.method === "POST" && route.name === "rewind") {
        const body = await readJson<RewindSessionRequest>(request);
        if (typeof body.messageId !== "string" || body.messageId.length === 0) {
            sendJson(response, 400, { error: "Choose a user message to rewind to." });
            return;
        }
        try {
            sendJson<RewindSessionResponse>(response, 200, session.rewind(body.messageId));
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The session could not be rewound.",
            });
        }
        return;
    }

    if (request.method === "POST" && route.name === "compact") {
        const result = await session.compact();
        sendJson<CompactSessionResponse>(response, 200, {
            result,
            session: session.snapshot(),
        });
        return;
    }

    if (request.method === "PATCH" && route.name === "effort") {
        const body = await readJson<ChangeEffortRequest>(request);
        sendJson(response, 200, { session: session.changeEffort(body) });
        return;
    }

    if (request.method === "PATCH" && route.name === "service-tier") {
        const body = await readJson<ChangeServiceTierRequest>(request);
        sendJson(response, 200, { session: session.changeServiceTier(body) });
        return;
    }

    if (request.method === "PATCH" && route.name === "model") {
        const body = await readJson<ChangeModelRequest>(request);
        sendJson(response, 200, { session: session.changeModel(body) });
        return;
    }

    if (request.method === "PATCH" && route.name === "permissions") {
        const body = await readJson<ChangePermissionModeRequest>(request);
        if (!isPermissionMode(body.permissionMode)) {
            sendJson(response, 400, {
                error: INVALID_PERMISSION_MODE_MESSAGE,
            });
            return;
        }
        sendJson(response, 200, { session: await session.changePermissionMode(body) });
        return;
    }

    if (request.method === "POST" && route.name === "secrets") {
        const body = await readJson<AttachSecretRequest | null>(request);
        if (
            body === null ||
            typeof body !== "object" ||
            typeof body.secretId !== "string" ||
            body.secretId.length === 0
        ) {
            sendJson(response, 400, { error: "Choose a secret to attach." });
            return;
        }
        const scope = body.scope ?? "session";
        if (scope !== "session" && scope !== "project") {
            sendJson(response, 400, { error: "Secret scope must be Session or Project." });
            return;
        }
        try {
            sendJson<SecretSessionResponse>(response, 200, {
                session:
                    store.attachSecret(session.id, body.secretId, scope)?.snapshot() ??
                    session.snapshot(),
            });
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The secret could not be attached.",
            });
        }
        return;
    }

    if (request.method === "DELETE" && route.name === "secret") {
        const scope = url.searchParams.get("scope") ?? "session";
        if (scope !== "session" && scope !== "project") {
            sendJson(response, 400, { error: "Secret scope must be Session or Project." });
            return;
        }
        sendJson<SecretSessionResponse>(response, 200, {
            session:
                store.detachSecret(session.id, route.secretId, scope)?.snapshot() ??
                session.snapshot(),
        });
        return;
    }

    if (request.method === "POST" && route.name === "goal") {
        const body = await readJson<SetGoalRequest>(request);
        if (typeof body.objective !== "string") {
            sendJson(response, 400, { error: "Goal objective must be text." });
            return;
        }
        try {
            session.setGoal(body);
            sendJson<GoalSessionResponse>(response, 200, { session: session.snapshot() });
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The goal could not be started.",
            });
        }
        return;
    }

    if (request.method === "PATCH" && route.name === "goal") {
        const body = await readJson<ChangeSessionGoalStatusRequest>(request);
        if (!isGoalStatus(body.status)) {
            sendJson(response, 400, {
                error: "Goal status must be Active, Paused, Blocked, or Complete.",
            });
            return;
        }
        try {
            session.changeGoalStatus(body);
            sendJson<GoalSessionResponse>(response, 200, { session: session.snapshot() });
        } catch (error) {
            sendJson(response, 409, {
                error: error instanceof Error ? error.message : "The goal could not be updated.",
            });
        }
        return;
    }

    if (request.method === "DELETE" && route.name === "goal") {
        session.clearGoal();
        sendJson<GoalSessionResponse>(response, 200, { session: session.snapshot() });
        return;
    }

    if (request.method === "POST" && route.name === "user-input") {
        const body = await readJson<AnswerUserInputRequest>(request);
        try {
            const snapshot = session.answerUserInput(route.requestId, body);
            if (snapshot === undefined) {
                sendJson(response, 409, {
                    error: "This question is no longer waiting for an answer.",
                });
                return;
            }
            sendJson(response, 200, { session: snapshot });
        } catch (error) {
            sendJson(response, 400, {
                error: error instanceof Error ? error.message : "The answer is invalid.",
            });
        }
        return;
    }

    if (request.method === "GET" && route.name === "events") {
        const after = url.searchParams.get("after") ?? undefined;
        const events = session.events.since(after);
        if (events === undefined) {
            sendJson(response, 409, { error: "Event cursor not found" });
            return;
        }
        sendJson(response, 200, {
            events:
                after === undefined
                    ? events.filter((event) => !isTransientInferenceSessionEvent(event))
                    : events,
        });
        return;
    }

    if (request.method === "GET" && route.name === "stream") {
        streamEvents(request, response, session, url.searchParams.get("after") ?? undefined);
        return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
}

function createInitializationState(options: ProtocolHttpServerOptions): InitializationState {
    const state: InitializationState = {
        catalog: options.modelCatalog,
        errorMessage: undefined,
        identity: options.identity ?? getDaemonIdentity(),
        ready: options.initialization === undefined,
    };
    if (options.initialization !== undefined) {
        void options.initialization.then(
            (catalog) => {
                state.catalog = catalog;
                state.errorMessage = undefined;
                state.ready = true;
            },
            (error: unknown) => {
                state.errorMessage = errorToMessage(error);
                state.ready = false;
            },
        );
    }
    return state;
}

function healthResponse(
    initialization: InitializationState,
    durableGlobalEventQueue: boolean,
): HealthResponse {
    if (initialization.ready && initialization.catalog !== undefined) {
        return {
            catalog: initialization.catalog,
            durableGlobalEventQueue,
            healthy: true,
            identity: initialization.identity,
            ready: true,
            status: "ready",
        };
    }
    if (initialization.errorMessage !== undefined) {
        return {
            durableGlobalEventQueue,
            errorMessage: initialization.errorMessage,
            healthy: false,
            identity: initialization.identity,
            ready: false,
            status: "error",
        };
    }

    return {
        durableGlobalEventQueue,
        healthy: true,
        identity: initialization.identity,
        ready: false,
        status: "starting",
    };
}

function parseLimit(value: string | null): number | undefined {
    if (value === null) {
        return undefined;
    }

    const limit = Number.parseInt(value, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
        return undefined;
    }
    return Math.min(limit, 500);
}

function parseFileSearchLimit(value: string | null): number {
    if (value === null) {
        return 20;
    }

    const limit = Number.parseInt(value, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
        return 20;
    }
    return Math.min(limit, 50);
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
    const authorization = request.headers.authorization;
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
        return false;
    }

    const received = Buffer.from(authorization.slice("Bearer ".length));
    const expected = Buffer.from(token);
    return received.length === expected.length && timingSafeEqual(received, expected);
}

function matchRoute(pathname: string):
    | {
          name:
              | "global-events"
              | "global-events-stream"
              | "global-events-trim"
              | "config"
              | "health"
              | "models"
              | "secret-registrations"
              | "sessions"
              | "shutdown";
          sessionId?: undefined;
      }
    | { name: "secret-registration"; secretId: string; sessionId?: undefined }
    | {
          name:
              | "abort"
              | "activity"
              | "background-processes-stop"
              | "compact"
              | "current-provider-quota"
              | "effort"
              | "events"
              | "files"
              | "fork"
              | "goal"
              | "messages"
              | "model"
              | "permissions"
              | "reset"
              | "rewind"
              | "secrets"
              | "service-tier"
              | "session"
              | "stream"
              | "steer"
              | "subagents"
              | "usage";
          sessionId: string;
      }
    | { name: "user-input"; requestId: string; sessionId: string }
    | { name: "secret"; secretId: string; sessionId: string }
    | { name: "workflow-stop"; sessionId: string; workflowRunId: string }
    | undefined {
    if (pathname === "/health") return { name: "health" };
    if (pathname === "/config") return { name: "config" };
    if (pathname === "/events") return { name: "global-events" };
    if (pathname === "/events/stream") return { name: "global-events-stream" };
    if (pathname === "/events/trim") return { name: "global-events-trim" };
    if (pathname === "/models") return { name: "models" };
    if (pathname === "/secrets") return { name: "secret-registrations" };
    if (pathname === "/sessions") return { name: "sessions" };
    if (pathname === "/shutdown") return { name: "shutdown" };

    const globalParts = pathname.split("/").filter(Boolean);
    if (globalParts.length === 2 && globalParts[0] === "secrets") {
        return {
            name: "secret-registration",
            secretId: decodeURIComponent(globalParts[1] ?? ""),
        };
    }

    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] !== "sessions" || parts[1] === undefined) {
        return undefined;
    }

    const sessionId = decodeURIComponent(parts[1]);
    if (parts.length === 2) return { name: "session", sessionId };
    if (parts.length === 4 && parts[2] === "user-input" && parts[3] !== undefined) {
        return {
            name: "user-input",
            requestId: decodeURIComponent(parts[3]),
            sessionId,
        };
    }
    if (
        parts.length === 5 &&
        parts[2] === "workflows" &&
        parts[3] !== undefined &&
        parts[4] === "stop"
    ) {
        return {
            name: "workflow-stop",
            sessionId,
            workflowRunId: decodeURIComponent(parts[3]),
        };
    }
    if (parts.length === 4 && parts[2] === "background-processes" && parts[3] === "stop") {
        return { name: "background-processes-stop", sessionId };
    }
    if (parts.length === 4 && parts[2] === "secrets" && parts[3] !== undefined) {
        return { name: "secret", secretId: decodeURIComponent(parts[3]), sessionId };
    }
    if (parts.length !== 3) return undefined;

    if (parts[2] === "abort") return { name: "abort", sessionId };
    if (parts[2] === "activity") return { name: "activity", sessionId };
    if (parts[2] === "compact") return { name: "compact", sessionId };
    if (parts[2] === "current-provider-quota") {
        return { name: "current-provider-quota", sessionId };
    }
    if (parts[2] === "effort") return { name: "effort", sessionId };
    if (parts[2] === "events") return { name: "events", sessionId };
    if (parts[2] === "files") return { name: "files", sessionId };
    if (parts[2] === "fork") return { name: "fork", sessionId };
    if (parts[2] === "goal") return { name: "goal", sessionId };
    if (parts[2] === "messages") return { name: "messages", sessionId };
    if (parts[2] === "model") return { name: "model", sessionId };
    if (parts[2] === "permissions") return { name: "permissions", sessionId };
    if (parts[2] === "reset") return { name: "reset", sessionId };
    if (parts[2] === "rewind") return { name: "rewind", sessionId };
    if (parts[2] === "secrets") return { name: "secrets", sessionId };
    if (parts[2] === "service-tier") return { name: "service-tier", sessionId };
    if (parts[2] === "stream") return { name: "stream", sessionId };
    if (parts[2] === "steer") return { name: "steer", sessionId };
    if (parts[2] === "subagents") return { name: "subagents", sessionId };
    if (parts[2] === "usage") return { name: "usage", sessionId };
    return undefined;
}

function isSessionMutation(routeName: string, method: string | undefined): boolean {
    return (
        (method === "POST" &&
            [
                "abort",
                "activity",
                "background-processes-stop",
                "compact",
                "fork",
                "messages",
                "reset",
                "rewind",
                "secrets",
                "steer",
            ].includes(routeName)) ||
        (method === "POST" && routeName === "workflow-stop") ||
        (["DELETE", "PATCH", "POST"].includes(method ?? "") && routeName === "goal") ||
        (method === "POST" && routeName === "user-input") ||
        (method === "DELETE" && routeName === "secret") ||
        (method === "PATCH" &&
            ["effort", "model", "permissions", "service-tier"].includes(routeName))
    );
}

function isMutatingProtocolRequest(request: IncomingMessage): boolean {
    const url = new URL(request.url ?? "/", "http://unix");
    const route = matchRoute(url.pathname);
    if (route === undefined) return false;
    if (route.name === "config") return request.method === "PATCH";
    if (route.name === "global-events-trim") return request.method === "POST";
    if (route.name === "secret-registrations") return request.method === "POST";
    if (route.name === "secret-registration") return request.method === "DELETE";
    if (route.name === "sessions") return request.method === "POST";
    if (route.sessionId === undefined) return false;
    return isSessionMutation(route.name, request.method);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    try {
        return (body.length === 0 ? {} : JSON.parse(body)) as T;
    } catch {
        throw new InvalidJsonBodyError();
    }
}

class InvalidJsonBodyError extends Error {}

function streamEvents(
    request: IncomingMessage,
    response: ServerResponse,
    session: { events: SessionEventLog },
    after: string | undefined,
): void {
    const cursor = request.headers["last-event-id"];
    const eventId = Array.isArray(cursor) ? cursor.at(-1) : cursor;
    const catchup = session.events.since(eventId ?? after);
    if (catchup === undefined) {
        sendJson(response, 409, { error: "Event cursor not found" });
        return;
    }

    response.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
    });
    response.write(": connected\n\n");

    for (const event of catchup) {
        writeSseEvent(response, event);
    }

    const heartbeat = setInterval(() => {
        response.write(": keepalive\n\n");
    }, 15_000);
    heartbeat.unref?.();

    const unsubscribe = session.events.subscribe((event) => {
        writeSseEvent(response, event);
    });

    request.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        response.end();
    });
}

function writeSseEvent(response: ServerResponse, event: SessionEvent): void {
    response.write(`id: ${event.id}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
}
