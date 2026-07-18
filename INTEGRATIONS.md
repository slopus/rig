# Integration API

Rig can expose integration-owned functions and skill instructions to a model
without installing their implementations or source files in the daemon.
Requests are stored in SQLite before they are published, remain pending across
daemon restarts, and are completed through a separate authenticated HTTP request.

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
    ],
    "skills": [
        {
            "name": "support-workflow",
            "description": "Resolve support tickets using the team's workflow.",
            "location": "durable"
        }
    ]
}
```

When present, `systemPrompt` replaces Rig's assembled prompt; `null` restores
Rig's normal prompt. Durable skill catalog instructions are appended when
`skills` is non-empty. When present, `externalTools` replaces the session's prior
external function set. An empty array disables all external functions. The JSON
Schema in `parameters` is forwarded to the provider unchanged. When present,
`skills` replaces the session's integration-owned skill set. Every supplied
skill must use `"location": "durable"`; an empty array disables durable skills.
Rig adds their metadata to the skills catalog without fetching their bodies.

Use `POST /messages` with either `"all": true` or a non-empty `sessionIds`
array to submit the same configured message to multiple primary sessions. IDs
must be unique, and a single broadcast is bounded to 500 sessions.

## Consume durable calls

Pending work is available from `GET /external-tool-calls` and through the
`external_tool_call_requested` session/global event. Each call includes its
stable `id`, `sessionId`, `runId`, provider `toolCallId`, function definition,
and arguments.

Complete a call with:

```text
POST /sessions/{sessionId}/external-tool-calls/{id}
```

When the model chooses a durable skill, Rig invokes its built-in `read_skill`
tool. The resulting external call also includes the selected `skill` metadata.
Complete that call with the full `SKILL.md` text:

```json
{
    "status": "completed",
    "output": "---\nname: support-workflow\ndescription: Resolve support tickets.\n---\n\n# Workflow\n..."
}
```

The contents are returned to the model as the `read_skill` result. Failed skill
loads use the same failure shape as external functions. Durable skills currently
cover `SKILL.md` itself; references to other integration-owned resources require
an integration-provided access mechanism.

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

External functions and durable skill reads cross a boundary that Rig cannot
sandbox. They therefore require Auto or Full access, and Auto reviews each
invocation before publishing it. The daemon bearer token is required for every
endpoint above.
