import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import type {
    AbortRunResponse,
    AnswerUserInputRequest,
    ChangeEffortRequest,
    ChangeModelRequest,
    ChangePermissionModeRequest,
    ChangeSessionGoalStatusRequest,
    CompactSessionResponse,
    CreateSessionRequest,
    CreateSessionResponse,
    ForkSessionResponse,
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
} from "../protocol/index.js";
import { InMemorySessionStore } from "./InMemorySessionStore.js";
import { createModelCatalog } from "./createModelCatalog.js";
import { FileSearchService, type FileSearchServiceContract } from "./FileSearchService.js";
import type { SessionEventLog } from "./SessionEventLog.js";
import type { SessionStore } from "./SessionStore.js";
import { isPermissionMode } from "../permissions/index.js";
import { isGoalStatus } from "../goals/index.js";

export interface ProtocolHttpServerOptions {
    initialization?: Promise<ModelCatalog>;
    modelCatalog?: ModelCatalog;
    fileSearchService?: FileSearchServiceContract;
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

    const server = createServer((request, response) => {
        void handleRequest(
            request,
            response,
            store,
            state,
            fileSearchService,
            options.token,
            options.onShutdown,
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
    ready: boolean;
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    store: SessionStore,
    initialization: InitializationState,
    fileSearchService: FileSearchServiceContract,
    token: string,
    onShutdown: (() => void) | undefined,
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
        sendJson<HealthResponse>(response, 200, healthResponse(initialization));
        return;
    }

    if (request.method === "POST" && route.name === "shutdown") {
        sendJson<ShutdownServerResponse>(response, 202, { shuttingDown: true });
        setImmediate(() => onShutdown?.());
        return;
    }

    if (!initialization.ready || initialization.catalog === undefined) {
        sendJson(response, 503, healthResponse(initialization));
        return;
    }

    if (request.method === "GET" && route.name === "models") {
        sendJson<ListModelsResponse>(response, 200, { catalog: initialization.catalog });
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
        const session = store.create(body);
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
        sendJson<AbortRunResponse>(response, 200, session.abort());
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
        sendJson(response, 200, { session: session.changePermissionMode(body) });
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
        const events = session.events.since(url.searchParams.get("after") ?? undefined);
        if (events === undefined) {
            sendJson(response, 409, { error: "Event cursor not found" });
            return;
        }
        sendJson(response, 200, { events });
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

function healthResponse(initialization: InitializationState): HealthResponse {
    if (initialization.ready && initialization.catalog !== undefined) {
        return {
            catalog: initialization.catalog,
            healthy: true,
            ready: true,
            status: "ready",
        };
    }
    if (initialization.errorMessage !== undefined) {
        return {
            errorMessage: initialization.errorMessage,
            healthy: false,
            ready: false,
            status: "error",
        };
    }

    return {
        healthy: true,
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
    | { name: "health" | "models" | "sessions" | "shutdown"; sessionId?: undefined }
    | {
          name:
              | "abort"
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
    if (parts[2] === "stream") return { name: "stream", sessionId };
    if (parts[2] === "steer") return { name: "steer", sessionId };
    if (parts[2] === "subagents") return { name: "subagents", sessionId };
    return undefined;
}

function isSessionMutation(routeName: string, method: string | undefined): boolean {
    return (
        (method === "POST" &&
            ["abort", "compact", "fork", "messages", "reset", "rewind", "steer"].includes(
                routeName,
            )) ||
        (method === "POST" && routeName === "workflow-stop") ||
        (["DELETE", "PATCH", "POST"].includes(method ?? "") && routeName === "goal") ||
        (method === "POST" && routeName === "user-input") ||
        (method === "PATCH" && ["effort", "model", "permissions"].includes(routeName))
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

function sendJson<T>(response: ServerResponse, statusCode: number, payload: T): void {
    if (response.headersSent) {
        return;
    }

    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json; charset=utf-8",
    });
    response.end(body);
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
