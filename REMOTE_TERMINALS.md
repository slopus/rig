# Remote terminals

Rig exposes session-scoped interactive terminals independently of agent runs. Each terminal owns a
real host or Docker PTY and one canonical Ghostty emulator in the daemon. Lifecycle operations use
the daemon's existing JSON-over-HTTP API; interactive display and input use the
[`@slopus/ghostty-web`](packages/ghostty-web/README.md) hybrid binary protocol over WebSocket.

HTTP Upgrade keeps terminal attachments on the daemon's existing routing and bearer-token rails.
WebSocket supplies standard binary framing, full-duplex input, and the browser-compatible transport
needed by future web clients. The local daemon currently listens on a Unix socket; the same attach
path can be served over TCP later without changing the terminal wire protocol.

All requests and WebSocket upgrades use the daemon's bearer token. Replace `{sessionId}` and
`{terminalId}` with URL-encoded identifiers.

## Lifecycle over HTTP

| Method   | Path                                                  | Purpose                    |
| -------- | ----------------------------------------------------- | -------------------------- |
| `POST`   | `/sessions/{sessionId}/terminals`                     | Create a terminal          |
| `GET`    | `/sessions/{sessionId}/terminals`                     | List terminal metadata     |
| `PATCH`  | `/sessions/{sessionId}/terminals/{terminalId}`        | Request a terminal resize  |
| `DELETE` | `/sessions/{sessionId}/terminals/{terminalId}`        | Stop the terminal          |
| Upgrade  | `/sessions/{sessionId}/terminals/{terminalId}/attach` | Attach the binary protocol |

Create accepts `cols`, `rows`, `maxScrollback`, `cwd`, `shell`, and an optional `command`. Defaults
are 80 columns, 24 rows, and 10,000 scrollback rows. Without a command, Rig starts the environment's
interactive shell. Lifecycle responses contain stable terminal ID and epoch, dimensions, running
or exited status, and the exit code when known. They do not contain terminal screen snapshots.

Resize accepts `{ "cols": 100, "rows": 30 }`. Rig performs the request through the protocol's
canonical resize operation: it drains parsing, resizes the PTY and server Ghostty state, broadcasts
an output barrier and resize revision to every attachment, and only then releases post-resize output.

## Hybrid binary attachment

After a successful WebSocket upgrade, every binary WebSocket message contains exactly one complete,
length-framed ghostty-web wire packet. Text WebSocket messages are rejected. WebSocket message
compression is disabled because the wire protocol applies bounded compression itself.

The server selects one of two display modes:

- **VT replay** sends ordered PTY byte deltas. A Ghostty-backed replica applies those bytes locally
  and acknowledges them only after its emulator has consumed them.
- **Semantic grid** sends a current keyframe followed by changed-row patches. It recovers clients
  whose parser or geometry no longer matches and lets a slow semantic renderer skip transient
  redraws instead of accumulating them.

PTY bytes enter the canonical driver immediately—there is no output coalescing timer and no
full-viewport JSON rendering per write. Output chunks are encoded once and fanned out to all current
viewers. Each attachment advertises byte credit. The WebSocket-to-Duplex bridge withholds its write
callback while `bufferedAmount` is above its low-water mark, so Node stream backpressure reaches the
protocol's credit window. At most one WebSocket send is active in the bridge, while protocol replay,
per-client backlog, resize-held output, frames, and packet batches retain their own explicit caps.

## Ordering and recovery

- Terminal IDs stay stable for the lifetime of the daemon terminal. A new PTY gets a new terminal
  epoch, so offsets from an earlier process cannot be reused.
- Every attachment receives a server-issued input lease. Input sequence IDs increase monotonically;
  acknowledged or duplicated input is not replayed, gaps are rejected, and one lease cannot be
  active on two connections.
- A reconnect presents its terminal epoch, lease, last applied output offset, last input sequence,
  and any unacknowledged input. Replay is used only when the epoch, parser, resize revision, lease,
  and retained byte range still match. Otherwise a grid-capable renderer receives a semantic
  keyframe; a VT-only replica fails closed.
- Resize barriers prevent output produced for the new geometry from being applied before the client
  replica resizes. A client that missed a resize cannot raw-replay bytes into stale geometry.
- Process exit is durable and ordered after the final display barrier. A viewer attaching after exit
  receives the same final display followed by the retained exit code.
- Scrollback is requested through protocol packets, not HTTP. Pages require a history epoch,
  revision, absolute base row, and positioned cells; optional style and palette tables may accompany
  them. A client can supply the prior basis on its next request; the daemon rejects it if output or
  retention shifted the history.

The package README summarizes the wire contract, its bounds, and the independent protocol test
matrix.
