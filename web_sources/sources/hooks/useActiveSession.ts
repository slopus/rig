import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
    abortRun,
    answerUserInput,
    changeSessionEffort,
    changeSessionModel,
    changeSessionPermissionMode,
    fetchSession,
    fetchSubagents,
    resetSession,
    streamSessionEvents,
    submitMessage,
} from "../api";
import type {
    AssistantMessage,
    ContentBlock,
    ImageBlock,
    Message,
    PermissionMode,
    ProtocolSession,
    SessionEvent,
    SubagentSummary,
    UserMessage,
    UserInputRequest,
    UserInputResponse,
} from "../protocol";
import { upsertSubagentSummary } from "../upsertSubagentSummary";

/**
 * Return value of {@link useActiveSession}. Instantiate ONCE (in App.tsx) and
 * pass down to both ChatPanel and InspectorPanel so only one SSE stream is
 * open per selected session.
 */
export interface ActiveSessionState {
    /** Requests an abort of the active run. */
    abort: () => Promise<void>;
    /** Answers a pending structured question from the model. */
    answerUserInput: (requestId: string, response: UserInputResponse) => Promise<void>;
    /** PATCHes the session effort. */
    changeEffort: (effort: string | undefined) => Promise<void>;
    /** PATCHes the session model (and optionally effort). */
    changeModel: (providerId: string, modelId: string, effort?: string) => Promise<void>;
    /** PATCHes the session permission mode. */
    changePermissionMode: (permissionMode: PermissionMode) => Promise<void>;
    /** True after abort was requested and until the run settles. */
    isAborting: boolean;
    /** True while the initial `GET /api/sessions/:id` is in flight. */
    isLoading: boolean;
    /** True while a run is active (session status running or queued). */
    isRunning: boolean;
    /** Error from the initial session load, if it failed. */
    loadError: string | undefined;
    /**
     * Full transcript, including optimistic user messages that the server has
     * not echoed back yet (optimistic entries always sort last and have ids
     * prefixed with "optimistic-").
     */
    messages: readonly Message[];
    /** Structured questions currently waiting for this user. */
    pendingUserInputs: readonly UserInputRequest[];
    /** Resets the conversation (`POST /api/sessions/:id/reset`). */
    reset: () => Promise<void>;
    /** Human-readable error from the last failed run or submit, if any. */
    runError: string | undefined;
    /** The loaded session; undefined while loading or when nothing is selected. */
    session: ProtocolSession | undefined;
    /** Live partial assistant message while the model is streaming. */
    streamingPartial: AssistantMessage | undefined;
    /** Set when the daemon permanently rejected the event stream. */
    streamError: string | undefined;
    /** Direct child agents whose histories can be opened from this session. */
    subagents: readonly SubagentSummary[];
    /**
     * Submits a user message. Images become leading ImageBlocks in `content`
     * (base64 data without the `data:` prefix), followed by the text block
     * when the text is not empty. Resolves true when the daemon accepted the
     * message and false when the send failed (the failure is surfaced via
     * `runError`).
     */
    submit: (text: string, images?: readonly ImageBlock[]) => Promise<boolean>;
}

interface OptimisticEntry {
    localId: string;
    message: UserMessage;
    runId: string | undefined;
}

interface ReducerState {
    isAborting: boolean;
    isLoading: boolean;
    loadError: string | undefined;
    messages: readonly Message[];
    optimistic: readonly OptimisticEntry[];
    runError: string | undefined;
    session: ProtocolSession | undefined;
    streamError: string | undefined;
    streamingPartial: AssistantMessage | undefined;
    subagents: readonly SubagentSummary[];
    /** Run ids already echoed via message_submitted (guards submit/echo races). */
    submittedRunIds: readonly string[];
}

type ReducerAction =
    | { type: "reset_for_session" }
    | {
          type: "session_loaded";
          session: ProtocolSession;
          subagents: readonly SubagentSummary[];
      }
    | { type: "load_failed"; errorMessage: string }
    | { type: "server_event"; event: SessionEvent }
    | { type: "stream_rejected"; errorMessage: string }
    | { type: "optimistic_added"; localId: string; message: UserMessage; sessionId: string }
    | { type: "optimistic_run_assigned"; localId: string; runId: string; sessionId: string }
    | { type: "optimistic_failed"; localId: string; errorMessage: string; sessionId: string }
    | { type: "session_replaced"; session: ProtocolSession }
    | { type: "session_updated"; session: ProtocolSession };

const initialState: ReducerState = {
    isAborting: false,
    isLoading: false,
    loadError: undefined,
    messages: [],
    optimistic: [],
    runError: undefined,
    session: undefined,
    streamError: undefined,
    streamingPartial: undefined,
    subagents: [],
    submittedRunIds: [],
};

function appendMessage(messages: readonly Message[], message: Message): readonly Message[] {
    if (messages.some((existing) => existing.id === message.id)) {
        return messages;
    }
    return [...messages, message];
}

function userMessageText(message: UserMessage): string {
    return message.blocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

/**
 * Drops the optimistic entry superseded by a message_submitted echo. Entries
 * are matched by runId; when the echo beats the POST response the pending
 * entry has no runId yet, so the oldest unassigned entry with the same text is
 * dropped instead (prevents a transient duplicate user bubble).
 */
function dropEchoedOptimistic(
    optimistic: readonly OptimisticEntry[],
    runId: string,
    message: UserMessage,
): readonly OptimisticEntry[] {
    const withoutRun = optimistic.filter((entry) => entry.runId !== runId);
    if (withoutRun.length !== optimistic.length) {
        return withoutRun;
    }
    const text = userMessageText(message);
    const matchIndex = withoutRun.findIndex(
        (entry) => entry.runId === undefined && userMessageText(entry.message) === text,
    );
    if (matchIndex === -1) {
        return withoutRun;
    }
    return withoutRun.filter((_, index) => index !== matchIndex);
}

function reduceServerEvent(state: ReducerState, event: SessionEvent): ReducerState {
    switch (event.type) {
        case "session_created": {
            return { ...state, session: event.data.session };
        }
        case "message_submitted": {
            return {
                ...state,
                messages: appendMessage(state.messages, event.data.message),
                optimistic: dropEchoedOptimistic(
                    state.optimistic,
                    event.data.runId,
                    event.data.message,
                ),
                submittedRunIds: [...state.submittedRunIds, event.data.runId],
            };
        }
        case "run_started": {
            return {
                ...state,
                isAborting: false,
                runError: undefined,
                session:
                    state.session !== undefined
                        ? { ...state.session, status: "running" }
                        : undefined,
            };
        }
        case "agent_event": {
            const loopEvent = event.data.event;
            if (loopEvent.type === "inference_iteration_start") {
                return state;
            }
            if ("partial" in loopEvent) {
                return { ...state, streamingPartial: loopEvent.partial };
            }
            return state;
        }
        case "agent_message": {
            return {
                ...state,
                messages: appendMessage(state.messages, event.data.message),
                streamingPartial: undefined,
            };
        }
        case "run_finished": {
            return {
                ...state,
                isAborting: false,
                streamingPartial: undefined,
                session:
                    state.session !== undefined
                        ? {
                              ...state.session,
                              status: event.data.stopReason === "aborted" ? "aborted" : "completed",
                          }
                        : undefined,
            };
        }
        case "run_error": {
            // A requested abort also fails queued runs ("The queued run was
            // stopped."); the user asked for that, so it is not an error.
            if (state.isAborting) {
                return {
                    ...state,
                    streamingPartial: undefined,
                    session:
                        state.session !== undefined
                            ? { ...state.session, status: "aborted" }
                            : undefined,
                };
            }
            return {
                ...state,
                isAborting: false,
                runError: event.data.errorMessage,
                streamingPartial: undefined,
                session:
                    state.session !== undefined ? { ...state.session, status: "error" } : undefined,
            };
        }
        case "abort_requested": {
            return { ...state, isAborting: true };
        }
        case "session_reset": {
            return {
                ...state,
                messages: event.data.snapshot.messages,
                optimistic: [],
                runError: undefined,
                streamingPartial: undefined,
                session:
                    state.session !== undefined
                        ? { ...state.session, snapshot: event.data.snapshot }
                        : undefined,
            };
        }
        case "session_title_changed": {
            if (state.session === undefined) {
                return state;
            }
            const session: ProtocolSession = {
                ...state.session,
                titleStatus: event.data.status,
            };
            if (event.data.title !== undefined) {
                session.title = event.data.title;
            }
            if (event.data.errorMessage !== undefined) {
                session.titleError = event.data.errorMessage;
            }
            return { ...state, session };
        }
        case "model_changed":
        case "effort_changed": {
            if (state.session === undefined) {
                return state;
            }
            const session: ProtocolSession = {
                ...state.session,
                modelId: event.data.modelId,
                snapshot: event.data.snapshot,
            };
            if (event.data.effort !== undefined) {
                session.effort = event.data.effort;
            } else {
                delete session.effort;
            }
            return { ...state, session };
        }
        case "permission_mode_changed": {
            if (state.session === undefined) return state;
            return {
                ...state,
                session: { ...state.session, permissionMode: event.data.permissionMode },
            };
        }
        case "user_input_requested": {
            if (state.session === undefined) return state;
            const withoutDuplicate = state.session.pendingUserInputs.filter(
                (request) => request.requestId !== event.data.requestId,
            );
            return {
                ...state,
                session: {
                    ...state.session,
                    pendingUserInputs: [...withoutDuplicate, event.data],
                },
            };
        }
        case "user_input_resolved": {
            if (state.session === undefined) return state;
            return {
                ...state,
                session: {
                    ...state.session,
                    pendingUserInputs: state.session.pendingUserInputs.filter(
                        (request) => request.requestId !== event.data.requestId,
                    ),
                },
            };
        }
        case "subagent_changed": {
            return {
                ...state,
                subagents: upsertSubagentSummary(state.subagents, event.data.subagent),
            };
        }
    }
}

function reduce(state: ReducerState, action: ReducerAction): ReducerState {
    switch (action.type) {
        case "reset_for_session": {
            return { ...initialState, isLoading: true };
        }
        case "session_loaded": {
            return {
                ...initialState,
                isLoading: false,
                messages: action.session.snapshot.messages,
                session: action.session,
                subagents: action.subagents,
            };
        }
        case "load_failed": {
            return { ...initialState, isLoading: false, loadError: action.errorMessage };
        }
        case "server_event": {
            return reduceServerEvent(state, action.event);
        }
        case "stream_rejected": {
            return { ...state, streamError: action.errorMessage };
        }
        case "optimistic_added": {
            if (state.session?.id !== action.sessionId) {
                return state;
            }
            return {
                ...state,
                optimistic: [
                    ...state.optimistic,
                    { localId: action.localId, message: action.message, runId: undefined },
                ],
                runError: undefined,
            };
        }
        case "optimistic_run_assigned": {
            if (state.session?.id !== action.sessionId) {
                return state;
            }
            // The message_submitted echo may have arrived before the POST
            // resolved; if so, drop the optimistic entry instead of tagging it.
            if (state.submittedRunIds.includes(action.runId)) {
                return {
                    ...state,
                    optimistic: state.optimistic.filter(
                        (entry) => entry.localId !== action.localId,
                    ),
                };
            }
            return {
                ...state,
                optimistic: state.optimistic.map((entry) =>
                    entry.localId === action.localId ? { ...entry, runId: action.runId } : entry,
                ),
            };
        }
        case "optimistic_failed": {
            if (state.session?.id !== action.sessionId) {
                return state;
            }
            return {
                ...state,
                optimistic: state.optimistic.filter((entry) => entry.localId !== action.localId),
                runError: action.errorMessage,
            };
        }
        case "session_replaced": {
            return {
                ...state,
                messages: action.session.snapshot.messages,
                optimistic: [],
                runError: undefined,
                session: action.session,
                streamingPartial: undefined,
            };
        }
        case "session_updated": {
            return { ...state, session: action.session };
        }
    }
}

function errorToMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/**
 * Owns the transcript state of the selected session: loads the snapshot,
 * follows the SSE stream (with after-cursor reconnects), and applies the
 * session event reducer.
 */
export function useActiveSession(sessionId: string | undefined): ActiveSessionState {
    const [state, dispatch] = useReducer(reduce, initialState);

    useEffect(() => {
        if (sessionId === undefined) {
            dispatch({ type: "reset_for_session" });
            return;
        }

        const controller = new AbortController();
        dispatch({ type: "reset_for_session" });

        const run = async () => {
            let session: ProtocolSession;
            try {
                const [response, subagentsResponse] = await Promise.all([
                    fetchSession(sessionId),
                    fetchSubagents(sessionId),
                ]);
                session = response.session;
                if (!controller.signal.aborted) {
                    dispatch({
                        type: "session_loaded",
                        session,
                        subagents: subagentsResponse.subagents,
                    });
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    dispatch({
                        type: "load_failed",
                        errorMessage: errorToMessage(error, "The session could not be loaded."),
                    });
                }
                return;
            }
            if (controller.signal.aborted) {
                return;
            }

            await streamSessionEvents(
                sessionId,
                session.lastEventId,
                (event) => {
                    dispatch({ type: "server_event", event });
                },
                controller.signal,
                {
                    // The daemon forgot our cursor (event log wiped): reseed
                    // the transcript and reconnect from the fresh cursor.
                    onCursorInvalid: async () => {
                        const [response, subagentsResponse] = await Promise.all([
                            fetchSession(sessionId),
                            fetchSubagents(sessionId),
                        ]);
                        if (controller.signal.aborted) {
                            return undefined;
                        }
                        dispatch({
                            type: "session_loaded",
                            session: response.session,
                            subagents: subagentsResponse.subagents,
                        });
                        return response.session.lastEventId;
                    },
                    onStreamRejected: (status) => {
                        dispatch({
                            type: "stream_rejected",
                            errorMessage: `The daemon rejected the event stream (HTTP ${status}).`,
                        });
                    },
                },
            );
        };

        void run();

        return () => {
            controller.abort();
        };
    }, [sessionId]);

    const submit = useCallback(
        async (text: string, images?: readonly ImageBlock[]) => {
            if (sessionId === undefined || state.session?.agent.type === "subagent") {
                return false;
            }
            const localId = `optimistic-${crypto.randomUUID()}`;
            // Image-only sends carry no text block: providers reject empty
            // text content blocks.
            const blocks: ContentBlock[] = [
                ...(images ?? []),
                ...(text !== "" ? [{ type: "text", text } as const] : []),
            ];
            const message: UserMessage = { role: "user", id: localId, blocks };
            dispatch({ type: "optimistic_added", localId, message, sessionId });
            try {
                const response = await submitMessage(
                    sessionId,
                    images !== undefined && images.length > 0
                        ? { text, content: blocks }
                        : { text },
                );
                dispatch({
                    type: "optimistic_run_assigned",
                    localId,
                    runId: response.runId,
                    sessionId,
                });
                return true;
            } catch (error) {
                dispatch({
                    type: "optimistic_failed",
                    localId,
                    errorMessage: errorToMessage(error, "The message could not be sent."),
                    sessionId,
                });
                return false;
            }
        },
        [sessionId, state.session?.agent.type],
    );

    const abort = useCallback(async () => {
        if (sessionId === undefined) {
            return;
        }
        await abortRun(sessionId);
    }, [sessionId]);

    const respondToUserInput = useCallback(
        async (requestId: string, response: UserInputResponse) => {
            if (sessionId === undefined) return;
            const result = await answerUserInput(sessionId, requestId, response);
            dispatch({ type: "session_updated", session: result.session });
        },
        [sessionId],
    );

    const reset = useCallback(async () => {
        if (sessionId === undefined) {
            return;
        }
        const response = await resetSession(sessionId);
        dispatch({ type: "session_replaced", session: response.session });
    }, [sessionId]);

    const changeModel = useCallback(
        async (providerId: string, modelId: string, effort?: string) => {
            if (sessionId === undefined) {
                return;
            }
            const response = await changeSessionModel(
                sessionId,
                effort !== undefined ? { modelId, providerId, effort } : { modelId, providerId },
            );
            dispatch({ type: "session_updated", session: response.session });
        },
        [sessionId],
    );

    const changeEffort = useCallback(
        async (effort: string | undefined) => {
            if (sessionId === undefined) {
                return;
            }
            const response = await changeSessionEffort(
                sessionId,
                effort !== undefined ? { effort } : {},
            );
            dispatch({ type: "session_updated", session: response.session });
        },
        [sessionId],
    );

    const changePermissionMode = useCallback(
        async (permissionMode: PermissionMode) => {
            if (sessionId === undefined) return;
            const response = await changeSessionPermissionMode(sessionId, { permissionMode });
            dispatch({ type: "session_updated", session: response.session });
        },
        [sessionId],
    );

    const messages = useMemo<readonly Message[]>(() => {
        if (state.optimistic.length === 0) {
            return state.messages;
        }
        return [...state.messages, ...state.optimistic.map((entry) => entry.message)];
    }, [state.messages, state.optimistic]);

    const isRunning =
        state.session !== undefined &&
        (state.session.status === "running" || state.session.status === "queued");

    return {
        abort,
        answerUserInput: respondToUserInput,
        changeEffort,
        changeModel,
        changePermissionMode,
        isAborting: state.isAborting,
        isLoading: state.isLoading,
        isRunning,
        loadError: state.loadError,
        messages,
        pendingUserInputs: state.session?.pendingUserInputs ?? [],
        reset,
        runError: state.runError,
        session: state.session,
        streamError: state.streamError,
        streamingPartial: state.streamingPartial,
        subagents: state.subagents,
        submit,
    };
}
