import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type {
    AbortRunResponse,
    AnswerUserInputRequest,
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
    GetDaemonConfigResponse,
    ListGlobalEventsResponse,
    HealthResponse,
    GoalSessionResponse,
    ListModelsResponse,
    ListSessionsResponse,
    ListSubagentsResponse,
    ModelCatalog,
    RewindSessionRequest,
    RewindSessionResponse,
    SearchFilesResponse,
    SessionEvent,
    SetGoalRequest,
    ShutdownServerResponse,
    SteerMessageResponse,
    StopWorkflowResponse,
    SubmitMessageRequest,
    SubmitMessageResponse,
    TrimGlobalEventsRequest,
    TrimGlobalEventsResponse,
    UpdateDaemonConfigRequest,
    UpdateDaemonConfigResponse,
} from "../protocol/index.js";
import { getDaemonIdentity } from "../daemon/index.js";
import { InMemorySessionStore } from "./InMemorySessionStore.js";
import { createModelCatalog } from "./createModelCatalog.js";
import { FileSearchService, type FileSearchServiceContract } from "./FileSearchService.js";
import type { SessionEventLog } from "./SessionEventLog.js";
import type { GlobalEventQueue } from "./GlobalEventQueue.js";
import type { SessionStore } from "./SessionStore.js";
import { isGlobalEventRoute } from "./isGlobalEventRoute.js";
import { parseGlobalEventCursor } from "./parseGlobalEventCursor.js";
import { parseGlobalEventLimit } from "./parseGlobalEventLimit.js";
import { sendJson } from "./sendJson.js";
import { streamGlobalEvents } from "./streamGlobalEvents.js";
import { isPermissionMode } from "../permissions/index.js";
import { isGoalStatus } from "../goals/index.js";
import { resolveDockerExecutionConfig, validateDockerExecutionConfig } from "../execution/index.js";
import type { DockerExecutionConfig } from "../execution/index.js";

export interface ProtocolHttpServerOptions {
    defaultDocker?: DockerExecutionConfig;
    identity?: DaemonIdentity;
    initialization?: Promise<ModelCatalog>;
    modelCatalog?: ModelCatalog;
    fileSearchService?: FileSearchServiceContract;
    globalEventQueue?: GlobalEventQueue;
    onDurableGlobalEventQueueChange?: (
        enabled: boolean,
    ) => GlobalEventQueue | undefined | Promise<GlobalEventQueue | undefined>;
    onShutdown?: () => void;
    store?: SessionStore;
    token: string;
}

export function createProtocolHttpServer(options: ProtocolHttpServerOptions): Server {
    const modelCatalog = options.modelCatalog ?? createModelCatalog();
    const store =
        options.store ??
        new InMemorySessionStore({
            modelCatalog,
        });
    const state = createInitializationState({ ...options, modelCatalog });
    const fileSearchService = options.fileSearchService ?? new FileSearchService();
    const runtimeConfig: ProtocolServerRuntimeConfig = {
        globalEventQueue: options.globalEventQueue,
        onDurableGlobalEventQueueChange: options.onDurableGlobalEventQueueChange,
    };

    const server = createServer((request, response) => {
        void handleRequest(
            request,
            response,
            store,
            state,
            fileSearchService,
            runtimeConfig,
            options.token,
            options.onShutdown,
            options.defaultDocker,
        ).catch((error: unknown) => {
            sendJson(response, 500, {
                error: error instanceof Error ? error.message : String(error),
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
        sendJson<ShutdownServerResponse>(response, 202, { shuttingDown: true });
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

    if (request.method === "POST" && route.name === "sessions") {
        const body = await readJson<CreateSessionRequest>(request);
        if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
            sendJson(response, 400, {
                error: "Permission mode must be Auto, Workspace write, Read only, or Full access.",
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
                    error: error instanceof Error ? error.message : String(error),
                });
                return;
            }
            sessionRequest.docker = resolveDockerExecutionConfig(docker, body.cwd);
        }
        const session = store.create(sessionRequest);
        sendJson<CreateSessionResponse>(response, 201, { session: session.snapshot() });
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
        const body = await readJson<SubmitMessageRequest>(request);
        sendJson<SubmitMessageResponse>(response, 202, session.submit(body));
        return;
    }

    if (request.method === "POST" && route.name === "steer") {
        const body = await readJson<SubmitMessageRequest>(request);
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
            sendJson<AbortRunResponse>(response, 200, await session.abort());
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
        sendJson(response, 200, { session: session.reset() });
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
                error: "Permission mode must be Auto, Workspace write, Read only, or Full access.",
            });
            return;
        }
        sendJson(response, 200, { session: await session.changePermissionMode(body) });
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
                    ? events.filter(
                          (event) =>
                              event.type !== "agent_event" ||
                              event.data.event.type === "context_compacted",
                      )
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
                state.errorMessage = error instanceof Error ? error.message : String(error);
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
              | "sessions"
              | "shutdown";
          sessionId?: undefined;
      }
    | {
          name:
              | "abort"
              | "background-processes-stop"
              | "compact"
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
              | "service-tier"
              | "session"
              | "stream"
              | "steer"
              | "subagents";
          sessionId: string;
      }
    | { name: "user-input"; requestId: string; sessionId: string }
    | { name: "workflow-stop"; sessionId: string; workflowRunId: string }
    | undefined {
    if (pathname === "/health") return { name: "health" };
    if (pathname === "/config") return { name: "config" };
    if (pathname === "/events") return { name: "global-events" };
    if (pathname === "/events/stream") return { name: "global-events-stream" };
    if (pathname === "/events/trim") return { name: "global-events-trim" };
    if (pathname === "/models") return { name: "models" };
    if (pathname === "/sessions") return { name: "sessions" };
    if (pathname === "/shutdown") return { name: "shutdown" };

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
    if (parts.length !== 3) return undefined;

    if (parts[2] === "abort") return { name: "abort", sessionId };
    if (parts[2] === "compact") return { name: "compact", sessionId };
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
    if (parts[2] === "service-tier") return { name: "service-tier", sessionId };
    if (parts[2] === "stream") return { name: "stream", sessionId };
    if (parts[2] === "steer") return { name: "steer", sessionId };
    if (parts[2] === "subagents") return { name: "subagents", sessionId };
    return undefined;
}

function isSessionMutation(routeName: string, method: string | undefined): boolean {
    return (
        (method === "POST" &&
            [
                "abort",
                "background-processes-stop",
                "compact",
                "fork",
                "messages",
                "reset",
                "rewind",
                "steer",
            ].includes(routeName)) ||
        (method === "POST" && routeName === "workflow-stop") ||
        (["DELETE", "PATCH", "POST"].includes(method ?? "") && routeName === "goal") ||
        (method === "POST" && routeName === "user-input") ||
        (method === "PATCH" &&
            ["effort", "model", "permissions", "service-tier"].includes(routeName))
    );
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    return (body.length === 0 ? {} : JSON.parse(body)) as T;
}

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
