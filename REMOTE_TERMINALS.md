# Remote terminal API

> This HTTP/SSE API is the compatibility snapshot surface. The independently tested
> [`@slopus/remote-terminal`](packages/remote-terminal/README.md) package implements the efficient
> hybrid binary client/server protocol for Ghostty-capable remote clients.

Rig exposes session-scoped interactive terminals independently of agent runs. A terminal uses the
session's host or Docker execution environment, owns a real PTY, and tracks its screen and
scrollback with `libghostty-vt`.

All requests use the daemon's existing bearer token. Replace `{sessionId}` and `{terminalId}` with
URL-encoded identifiers.

## Lifecycle

| Method   | Path                                                          | Purpose                         |
| -------- | ------------------------------------------------------------- | ------------------------------- |
| `POST`   | `/sessions/{sessionId}/terminals`                             | Create a terminal               |
| `GET`    | `/sessions/{sessionId}/terminals`                             | List terminal frames            |
| `GET`    | `/sessions/{sessionId}/terminals/{terminalId}`                | Read the latest frame           |
| `PATCH`  | `/sessions/{sessionId}/terminals/{terminalId}`                | Resize the PTY and tracked grid |
| `DELETE` | `/sessions/{sessionId}/terminals/{terminalId}`                | Stop the terminal               |
| `POST`   | `/sessions/{sessionId}/terminals/{terminalId}/input`          | Write UTF-8 input               |
| `GET`    | `/sessions/{sessionId}/terminals/{terminalId}/scrollback`     | Read a window of screen history |
| `GET`    | `/sessions/{sessionId}/terminals/{terminalId}/stream?after=N` | Follow frames over SSE          |

Create accepts `cols`, `rows`, `maxScrollback`, `cwd`, `shell`, and an optional `command`. Defaults
are 80 columns, 24 rows, and 10,000 scrollback rows. Without a command, Rig starts the environment's
interactive shell.

Resize accepts `{ "cols": 100, "rows": 30 }`. Input accepts `{ "data": "hello\n" }`.
Scrollback accepts `start` and `limit` query parameters; `limit` is capped at 500 rows per request.

## Frames

Every frame is an authoritative visible-grid snapshot with a monotonically increasing `revision`.
It includes terminal status, dimensions, title, cursor, total history rows, default colors, and
rows of positioned cells with complete Ghostty style attributes. Empty default cells are omitted;
clients render them with the frame's default colors.

The SSE stream uses the revision as its event ID and emits `event: frame`. Clients can reconnect
with `after` or `Last-Event-ID`. Because frames are authoritative, the server may coalesce
intermediate revisions for a slow or reconnecting client. A revision older than the retained
256-revision reconnect window returns HTTP 409; the client should then fetch the latest frame and
resume from its revision.

The final process state is emitted as its own revision with `status: "exited"` and `exitCode`.

## Ghostty helper

Rig first uses `RIG_TERMINAL_STATE_HELPER` when set, then looks for a bundled helper under
`terminal/bin/{platform}-{architecture}`. In a source checkout it falls back to building the
included Rust helper with Cargo on first terminal creation.
