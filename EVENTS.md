# Rig event reference

Rig emits session events for transcript changes, run lifecycle, configuration,
interactive input, tasks, goals, subagents, and workflows. This document lists
every event in the session protocol and every lower-level event carried by
`agent_event`.

## Event delivery and persistence

Every session event uses the same envelope:

```ts
{
    id: string;
    sessionId: string;
    createdAt: number;
    type: string;
    data: object;
}
```

Clients can read a session's events from `GET /sessions/{sessionId}/events` or
follow them with server-sent events from `GET /sessions/{sessionId}/stream`.
These per-session interfaces include every event below, including streaming
`agent_event` updates.

When the durable global event queue is enabled, non-streaming events are also
assigned a numeric global cursor and exposed through `GET /events` and
`GET /events/stream`. The global queue does not persist or publish
`agent_event`; completed messages and terminal run outcomes are delivered by
`agent_message`, `run_finished`, and `run_error` instead.

## Session events

“Global” indicates whether an event is persisted to the enabled durable global
event queue. Every event remains available through its per-session event log.

| Event                     | Emitted when                                                                                          | `data` payload                                                                               | Global |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| `session_created`         | A primary or subagent session is created.                                                             | `session`: complete `ProtocolSession` snapshot                                               | Yes    |
| `message_submitted`       | A user message, steering message, or notification is accepted.                                        | `displayText`, `message`, `runId`                                                            | Yes    |
| `run_started`             | A queued run begins executing.                                                                        | `runId`                                                                                      | Yes    |
| `agent_event`             | Inference streams, tools execute, permissions are reviewed, or background process state changes.      | `event`: one `AgentLoopEvent`; `runId`                                                       | **No** |
| `agent_message`           | The agent loop commits a complete assistant or tool-result message to the transcript.                 | `message`, `runId`                                                                           | Yes    |
| `run_finished`            | A run reaches a provider-reported terminal stop reason.                                               | `runId`, optional `agentRunId`, `modelLocked`, `stopReason`                                  | Yes    |
| `run_error`               | A run fails outside the normal completion path, or an accepted queued run is stopped before starting. | `runId`, `errorMessage`, `modelLocked`                                                       | Yes    |
| `abort_requested`         | An active or queued run is asked to stop.                                                             | Optional `runId`                                                                             | Yes    |
| `session_reset`           | The transcript and active session work are reset.                                                     | `snapshot`: reset `AgentSnapshot`                                                            | Yes    |
| `session_rewound`         | The transcript is rewound to before a selected user message.                                          | `messageId`, `snapshot`: resulting `AgentSnapshot`                                           | Yes    |
| `session_title_changed`   | Delayed session metadata generation starts, succeeds, or fails, or a goal supplies a title.           | `status`, optional `title`, `recap`, `metadataUpdatedAt`, `metadataRunId`, or `errorMessage` | Yes    |
| `model_changed`           | The selected provider model changes.                                                                  | `modelId`, optional `effort`, `snapshot`                                                     | Yes    |
| `effort_changed`          | The reasoning effort changes for the selected model.                                                  | `modelId`, optional `effort`, `snapshot`                                                     | Yes    |
| `permission_mode_changed` | The session permission mode is applied.                                                               | `permissionMode`                                                                             | Yes    |
| `user_input_requested`    | The agent opens a structured question for the user.                                                   | Complete `UserInputRequest`, including `requestId` and `questions`                           | Yes    |
| `user_input_resolved`     | A structured question is answered or cancelled.                                                       | `requestId`, `status`, optional `answers`                                                    | Yes    |
| `mcp_servers_changed`     | The session's active MCP server set changes.                                                          | `servers`                                                                                    | Yes    |
| `tasks_changed`           | Session tasks are created, updated, linked, or cleared.                                               | `tasks`: complete current task list                                                          | Yes    |
| `goal_changed`            | A goal is created, changes status, completes, or is cleared.                                          | `goal`: current `SessionGoal` or `null`                                                      | Yes    |
| `subagent_changed`        | A child agent's summary changes and its parent is notified.                                           | `subagent`: current `SubagentSummary`                                                        | Yes    |
| `workflow_changed`        | A workflow starts, advances, logs, completes, errors, or stops.                                       | `update`: incremental `WorkflowRunUpdate`                                                    | Yes    |

`stopReason` is one of `stop`, `length`, `toolUse`, `error`, or `aborted`.
`SessionTitleStatus` is one of `idle`, `generating`, `ready`, or `error`.

## `agent_event` subtypes

All events in this section are wrapped as
`{ type: "agent_event", data: { runId, event } }`. They are streamed and stored
in per-session event history, but they are not persisted to the durable global
queue.

### Inference message stream

| `event.type`     | Meaning                                                         | Additional fields                     |
| ---------------- | --------------------------------------------------------------- | ------------------------------------- |
| `start`          | Assistant message generation started.                           | `partial`                             |
| `text_start`     | A text content block started.                                   | `contentIndex`, `partial`             |
| `text_delta`     | More text arrived for a content block.                          | `contentIndex`, `delta`, `partial`    |
| `text_end`       | A text content block completed.                                 | `contentIndex`, `content`, `partial`  |
| `thinking_start` | A reasoning content block started.                              | `contentIndex`, `partial`             |
| `thinking_delta` | More reasoning content arrived.                                 | `contentIndex`, `delta`, `partial`    |
| `thinking_end`   | A reasoning content block completed.                            | `contentIndex`, `content`, `partial`  |
| `toolcall_start` | A model-generated tool call started.                            | `contentIndex`, `partial`             |
| `toolcall_delta` | More serialized tool-call arguments arrived.                    | `contentIndex`, `delta`, `partial`    |
| `toolcall_end`   | A model-generated tool call completed.                          | `contentIndex`, `toolCall`, `partial` |
| `done`           | The provider completed an assistant message normally.           | `reason`, `message`                   |
| `error`          | The provider ended an assistant message with an error or abort. | `reason`, `error`                     |

The terminal `done` and `error` stream events are not global queue entries. The
fully materialized message is subsequently emitted as `agent_message`, and the
run outcome is emitted as `run_finished` or `run_error`.

### Agent loop, tool, and process updates

| `event.type`                   | Meaning                                                                | Additional fields                                                                        |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `inference_iteration_start`    | A new model inference iteration started within the run.                | `iteration`                                                                              |
| `tool_execution_start`         | Execution of a model-requested tool began.                             | `toolCall`                                                                               |
| `tool_execution_end`           | Tool execution finished.                                               | `result`, containing `type`, `toolCallId`, `toolName`, `display`, and optional `isError` |
| `tool_execution_progress`      | A running tool reported new human-readable progress.                   | `toolCallId`, `display`                                                                  |
| `tool_execution_status`        | A running tool reported a status label.                                | `toolCallId`, `status`                                                                   |
| `tool_batch_rejected`          | A batch of tool calls was rejected, such as for duplicate identifiers. | `toolCallIds`                                                                            |
| `permission_review`            | Auto permissions reviewed a proposed tool action.                      | `toolCallId`, `action`, `decision`, `reason`, `risk`, `userAuthorization`                |
| `background_processes_changed` | The number or details of active managed background processes changed.  | `running`, optional `processes`                                                          |
| `background_processes_stopped` | Active background processes were stopped after a permission reduction. | `count`                                                                                  |

`decision` is `allow` or `ask`. `risk` and `userAuthorization` are each `low`,
`medium`, or `high`.

## Source of truth

The TypeScript definitions remain authoritative:

- Session event envelopes and payloads:
  `packages/rig/sources/protocol/SessionProtocol.ts`
- Agent loop events: `packages/rig/sources/agent/loop.ts`
- Inference message stream events: `packages/rig/sources/providers/types.ts`
- Durable global queue filter:
  `packages/rig/sources/server/shouldPersistGlobalEventType.ts`
