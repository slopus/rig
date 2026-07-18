# Integration API

Rig can expose integration-owned functions to a model without running those
functions inside the daemon. Calls are stored in SQLite before they are
published, remain pending across daemon restarts, and are completed through a
separate authenticated HTTP request.

## Submit a configured message

`POST /sessions/{sessionId}/messages` accepts the normal message fields plus:

```json
{
    "text": "Resolve ticket 42",
    "systemPrompt": "You are the support automation agent.",
    "externalTools": [
        {
            "name": "lookup_ticket",
            "description": "Look up a support ticket.",
            "parameters": {
                "type": "object",
                "properties": { "ticket": { "type": "number" } },
                "required": ["ticket"],
                "additionalProperties": false
            }
        }
    ]
}
```

When present, `systemPrompt` replaces Rig's assembled prompt; `null` restores
Rig's normal prompt. When present, `externalTools` replaces the session's prior
external function set. An empty array disables all external functions. The JSON
Schema in `parameters` is forwarded to the provider unchanged.

Use `POST /messages` with either `"all": true` or a non-empty `sessionIds`
array to submit the same configured message to multiple primary sessions. IDs
must be unique, and a single broadcast is bounded to 500 sessions.

## Consume durable calls

Pending work is available from `GET /external-tool-calls` and through the
`external_tool_call_requested` session/global event. Each call includes its
stable `id`, `sessionId`, `runId`, provider `toolCallId`, function definition,
and arguments.

Complete it with:

```text
POST /sessions/{sessionId}/external-tool-calls/{id}
```

Successful JSON output:

```json
{ "status": "completed", "output": { "state": "resolved" } }
```

Successful multimodal output may use `content` with Rig text/image content
blocks instead of `output`. Failures use:

```json
{
    "status": "failed",
    "error": { "message": "Ticket service unavailable", "code": "unavailable" }
}
```

Repeating an identical callback is idempotent and returns `accepted: false`.
A conflicting second result returns HTTP 409. Immediate functions in a model
tool batch finish first; durable external functions are then published in
parallel as a barrier. The model continues only after every durable call in
that batch has resolved.

Rig retains the latest 1,000 completed or cancelled calls per session for
callback idempotency and history. Pending and completed-but-not-yet-consumed
calls are never pruned.

External functions cross a boundary that Rig cannot sandbox. They therefore
require Auto or Full access, and Auto reviews each invocation before publishing
it. The daemon bearer token is required for every endpoint above.
