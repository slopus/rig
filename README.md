# rig

rig is an opinionated fork of pi for people who want a strong default coding-agent experience without rebuilding the same setup on every machine and in every repo.

The goal is simple: make the useful parts of modern coding harnesses available out of the box, while still letting each project opt in, opt out, or tune behavior when it needs to.

## Why this exists

Using pi directly can mean repeating the same configuration work everywhere:

- copying prompt files between machines
- wiring up vendor-specific tool definitions
- deciding which sandboxing settings are safe for each workflow
- wiring provider-specific subagent and long-running process tools by hand
- tuning prompts and tools separately for different inference providers
- remembering which projects should use which setup

That gets in the way when the real goal is to open a repo and have a good agent experience immediately. rig packages that baseline so the default is useful, portable, and consistent.

## What rig provides

rig stays close to pi and to upstream vendor behavior, but adds a curated default layer:

- Vendor-aligned tool definitions, kept close to the provider contracts instead of inventing unnecessary abstractions.
- Simplified system prompts that are easier to reason about and reuse.
- Per-model and per-vendor prompt/tool optimizations, so different inference providers can work well without forcing users into one stack.
- Provider-aligned background subagents with persistent transcripts and follow-up turns.
- Provider-aligned task planning with Codex `update_plan` and Claude's persistent task tools.
- Structured user questions with provider-aligned tools and terminal answer controls.
- MCP servers over stdio, streamable HTTP, or legacy SSE, configured from Codex and Rig TOML files.
- Background subagents with completion notifications and follow-up turns.
- Managed shell sessions for long-running commands and interactive input.
- Docker-backed sessions that keep agent filesystem and command execution inside a container.
- Auto mode for hands-off execution when a project allows it.
- Persistent goals that continue across agent turns until they are completed, paused, or blocked.
- Findings-first local code review with `/review` for current workspace changes.
- Headless execution with plain text, JSON, or streaming JSON output for scripts and CI.
- Saved-session pickers, latest-session shortcuts, and conversation forks.
- Codex-style conversation rewind that restores an earlier prompt for editing without changing working files.
- Automatic conversation compaction for long sessions, plus `/compact` when you want to free context space immediately.
- Sandboxing defaults that make local execution practical while keeping controls visible.
- Global and project-local configuration overrides.

## Design principles

rig is intentionally opinionated, but not locked down:

- Best of both worlds. Combine the strongest ideas from Codex and Claude Code into one coherent experience instead of cloning either product wholesale.
- Good defaults first. A fresh install should already feel usable.
- Simplicity and polish. Prefer clear, pleasant workflows over obscure features, exhaustive parity, or unnecessary configuration.
- Provider flexibility. The harness should work across proprietary and open source models.
- Project-local control. Repos should be able to enable, disable, or override behavior without changing global machine state.
- Close to upstream. Tool definitions and model expectations should track vendor semantics closely.
- Less ceremony. Common agent features should not require a custom setup ritual on every machine.

## Deliberate non-goals

rig aims for the best mainstream coding-agent experience, not a union of every
feature exposed by Codex and Claude Code. It intentionally does not implement:

- A dedicated Plan mode. Planning remains part of the normal agent workflow instead of a separate permission mode or interaction state.
- Vim or other modal terminal editing modes. The terminal input experience stays simple and conventional.
- Jupyter notebook parsing or editing. Export notebooks to a plain-text format before asking Rig to read them.
- Persistent command allow/deny history. Auto mode reviews each sensitive action against the current user request instead of maintaining a legacy command execution policy.
- Dedicated IDE integrations. Rig is a standalone terminal experience, not an extension or bridge for VS Code, JetBrains, or other editors.
- A separate Rig login flow. Rig uses credentials managed by the system Codex and Claude Code installations.
- Claude Code's extended skill runtime. Rig follows Codex skill discovery and instruction semantics without hooks, model overrides, or executable skill metadata.
- Niche parity features whose main value is matching a rarely used upstream flag, command, protocol, or edge case. New parity work should solve a common user need and fit rig's simpler product model.

## Intended experience

Install rig once, open a project, and get a capable coding harness with prompts, tools, subagents, managed processes, MCP, and sandboxing already wired together.

When a project needs different behavior, configure it locally. When a machine changes, avoid rebuilding the whole setup from memory. When an inference provider changes, keep the same project workflow and let rig handle the provider-specific differences where possible.

## Development

This is a pnpm TypeScript workspace:

- `packages/rig` contains the published `@slopus/rig` CLI, agent runtime, and local daemon. Its entry point is `packages/rig/sources/main.ts`.

Shared TypeScript and code-quality configuration, repository scripts, and release
orchestration live at the workspace root. The root commands below run the relevant
package scripts.

Reference implementations for coding agents live in
`~/Developer/coding-assistant-sources`, including the Codex and Claude Code
source trees. Use them when implementing or comparing provider-aligned behavior,
then adapt the useful parts to rig's simpler, curated experience.

```sh
pnpm install
```

Start the development CLI in its own terminal:

```sh
pnpm dev
```

Run the one-shot validation commands separately:

```sh
pnpm run check
pnpm test
pnpm run build
```

`pnpm dev` keeps its daemon socket, token, logs, registry, and session database in
the current folder's ignored `.rig-dev` directory, so it does not reuse or replace
the installed Rig daemon. The development CLI fingerprints its runtime source and
asks before restarting an older workspace daemon after the source changes. The
installed CLI performs the same check with the Rig package version.

### Authentication

Rig does not have its own login command. For Codex and Claude models, it uses the
credentials already managed by the system Codex and Claude Code installations.
Sign in with Codex or Claude Code before using the corresponding provider in Rig.

### Headless execution

Use `rig exec` to run an agent without opening the terminal interface. Pass the
prompt as arguments or pipe it through standard input:

```sh
rig exec "Review the current changes"
printf 'Run the tests and fix failures' | rig exec
```

Use `--json` for one machine-readable result or `--stream-json` for newline-delimited
session events followed by the final result:

```sh
rig exec --json "Summarize this repository"
rig exec --stream-json "Run the test suite"
```

Headless runs create normal persisted sessions. Continue the most recent session in
the current directory with `--last`, resume a specific session with `--resume`, or
branch from either one with `--fork`:

```sh
rig exec --last "Continue with the next issue"
rig exec --resume SESSION_ID "Try the alternative approach"
rig exec --last --fork "Explore a separate solution"
```

### Saved sessions

Run `rig resume` without an identifier to choose from saved sessions in the current
directory. Use `--last` to skip the picker and `--all` to include sessions from
other directories. `rig fork` accepts the same selectors and opens a new session
with a copy of the selected conversation:

```sh
rig resume
rig resume --last
rig resume --all
rig fork --last
rig fork SESSION_ID
```

The model and provider can be changed between responses from the terminal. They
remain temporarily unavailable while a response is running.

### Docker-backed sessions

Use the session options below to connect to a running Docker container or create
one from a local Docker image:

```sh
rig --docker-container my-development-container --docker-workdir /workspace

rig --docker-image my-project-dev:local \
  --docker-workdir /workspace \
  --docker-env NODE_ENV=development \
  --docker-mount .:/workspace
```

The same options work with `rig exec`. Use `--docker-socket`, `--docker-name`,
and repeated `--docker-env` or `--docker-mount` options for additional settings.
Use `--local` to override a configured Docker default for one new session.

Set a machine-level `[docker]` table in `~/.config/rig/config.toml` when Docker
should be preselected by default. A session-level selection overrides this
default. Rig talks to the daemon over its Unix socket; the Docker CLI does not
need to be installed in the agent environment.

Connect to a container that is already running:

```toml
[docker]
container = "my-development-container"
workdir = "/workspace"
```

Or create a session container from a local image tag or image hash:

```toml
[docker]
image = "my-project-dev:local"
workdir = "/workspace"
env = { NODE_ENV = "development", API_BASE_URL = "http://host.docker.internal:3000" }
mounts = [
  { source = ".", target = "/workspace" },
  { source = "/Users/me/.cache/my-project", target = "/cache", read_only = true },
]
```

Relative mount sources are resolved from the host directory where Rig starts.
Mount sources beginning with `~` are not expanded; use an absolute path for home
directories. Set `socket_path` when the daemon is not available at
`/var/run/docker.sock`, and set `name` when a stable custom container name is
useful.

Image-backed containers are created lazily when the session receives its first
message. Rig uses a stable session-derived name by default, so the container
filesystem remains available after the daemon restarts or the session is resumed.
Only images already present in the daemon are used; Rig does not pull images
implicitly. Images and connected containers must provide `/bin/sh`, `readlink`,
and common POSIX file utilities. Direct file reads are limited to 32 MB; shell
commands can process larger files without loading them into the daemon. Managed
containers are intentionally left in place until you remove them with Docker.

Docker configuration is accepted only from machine-level and runtime config.
A repository's `rig.toml` cannot select an image, daemon socket, environment, or
host mounts. Permission modes continue to guard direct file tools, while the
container and its explicitly configured mounts form the execution boundary for
shell commands.

When a session is idle, press Escape in the terminal to choose an earlier user
message. The selected message and everything after it are removed from session
history, and its text returns to the composer for editing. Rewind never changes
files in the working directory; image attachments must be added again.

### Amazon Bedrock

Amazon Bedrock is enabled automatically when the daemon starts with a non-empty
`AWS_BEARER_TOKEN_BEDROCK` environment variable. The provider uses `AWS_REGION`,
then `AWS_DEFAULT_REGION`, and defaults to `us-east-1` when neither is set.
[Generate an Amazon Bedrock API key](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-generate.html)
in the AWS console before exporting it:

```sh
export AWS_BEARER_TOKEN_BEDROCK="your Bedrock API key"
export AWS_REGION="us-east-1"
export RIG_PROVIDER="bedrock"
pnpm dev
```

`RIG_PROVIDER` chooses the inference provider independently from `RIG_MODEL`,
so the same canonical GPT or Claude model can be routed through Bedrock, Codex, or
the Claude SDK without changing its model ID.

The curated Claude, Kimi, and GLM models use the native Bedrock Runtime endpoint.
GPT-5.4 and GPT-5.5 use Bedrock Mantle's OpenAI Responses endpoint through the
official OpenAI Node SDK's `BedrockOpenAI` client because AWS does not serve those
models through Bedrock Runtime. The Kimi catalog includes Kimi K2.5 and Kimi K2
Thinking; the GLM catalog includes GLM 5, GLM 4.7, and GLM 4.7 Flash. Model
visibility is limited by AWS's regional availability; for example, Kimi K2.5 is
currently offered only in `us-east-1`, `us-east-2`, and `us-west-2`. Restart an
already-running daemon after changing these environment variables.

### Permission modes

New sessions start in **Workspace write** mode. File tools can edit the working
directory, while shell writes outside it and shell network access are blocked.
Git metadata and temporary files remain writable so normal development commands
continue to work.

Use `/permissions` in the terminal to switch the current session and its
subagents between:

- **Auto** — run routine workspace work immediately and review risky actions automatically, asking only when needed.
- **Workspace write** — write in the working directory with shell network access blocked.
- **Read only** — keep project files read only; shell commands may write temporary files.
- **Full access** — allow unrestricted filesystem, shell, and network access.

In Auto mode, shell commands remain workspace-sandboxed by default. Codex
`exec_command` can request `sandbox_permissions = "require_escalated"`, and
Claude `Bash` can request `dangerouslyDisableSandbox = true`; both requests are
reviewed before receiving one-call full access. Each model review is shown in
the transcript with its decision, risk, user-authorization confidence, and
rationale. Reviews follow the Codex guardian contract first and Claude tool
semantics second, and fail closed when the result is missing or malformed.

Set the terminal default in global or project-local `rig.toml`:

```toml
[defaults]
permission_mode = "workspace_write"
```

`RIG_PERMISSION_MODE` overrides the configured default for a newly created
terminal session. Accepted values are `workspace_write`, `read_only`, and
`full_access`, and `auto`.

### Fast mode

Use `/fast` to turn the Codex fast inference tier on or off. The footer adds
`fast` while it is active, and Rig sends the priority service tier on normal
turns and compaction requests. Fast inference uses twice the plan usage.

The toggle is offered only by providers that advertise support, and its value
is saved as the default for new sessions. It can also be configured directly:

```toml
[defaults]
service_tier = "fast" # Use "default" to explicitly turn it off.
```

### Terminal theme

Rig follows Codex terminal color semantics by default: primary text uses the
terminal foreground, secondary text is dimmed, links and inline code are cyan,
and status colors use the terminal's ANSI palette. Rig action labels keep the
orange brand accent, while command text uses the normal terminal foreground.

Override semantic roles in global or project-local `rig.toml`:

```toml
[theme]
primary = "default"
secondary = "dim"
accent = "cyan"
brand = "ansi:202"
success = "green"
warning = "yellow"
error = "red"
```

Each role accepts `default`, `dim`, an ANSI color name such as `bright_cyan`, a
palette index such as `ansi:202`, or a true-color value such as `#D97706`.

### Persistent goals

Use `/goal` followed by an objective to start long-running work that may need
more than one agent turn. Rig keeps the objective on the session and
automatically continues while the goal remains active. Use `/goal` by itself to
check its status, `/goal pause` to stop automatic continuation, `/goal resume`
to continue, and `/goal clear` to remove it.

Models receive `get_goal`, `create_goal`, and `update_goal` tools. A model can
mark the goal complete after verifying the full objective, or blocked when it
cannot make meaningful progress without user input or an external change.
Goals survive daemon restarts and remain available when sessions resume.

### Code review

Use `/review` to inspect current staged, unstaged, and untracked changes without
modifying them. Add a focus after the command when useful, such as
`/review focus on concurrency`. Reviews lead with actionable findings ordered
by severity and include file references, concrete impact, and remaining test
gaps. The command works in terminal sessions.

### Task tracking

Claude sessions use the current `TaskCreate`, `TaskGet`, `TaskUpdate`, and
`TaskList` tools. Tasks, dependencies, and progress survive daemon restarts and
are shared with the session's subagents. Use `/tasks` in the terminal to see the
current list.

### Background subagents

Claude sessions can set `run_in_background` on the `Agent` tool and use
`SendMessage` for follow-up work. Codex sessions use `spawn_agent`,
`followup_task`, `wait_agent`, `list_agents`, and
`interrupt_agent`. Each child keeps its own persisted conversation, reports a
completion notification to its parent, and can receive more work without losing
context. Use `/agents` in the terminal to see current status and open a child
transcript.

Team/swarm coordination, remote agents, and automatic worktree isolation are
intentionally outside this core workflow.

### Workflows

Workflows are enabled by default. Set a user-wide preference in
`~/.config/rig/config.toml`, and override it for a repository with `rig.toml`:

```toml
[features]
workflows = false
```

The repository value wins when both files define `workflows`. When disabled,
workflow tools and the `/workflows` command are not offered to the model or in
command suggestions. Existing saved sessions keep the setting they were created
with when the daemon restarts.

### Durable global event queue

The daemon can keep an opt-in, durable queue of session and subagent lifecycle
events for synchronizing Rig with another backend. High-volume streaming agent
updates are omitted; submitted and completed messages, run completions and
errors, and other non-streaming changes remain queued. Enable it from
`/configure` or in the user-wide `~/.config/rig/config.toml` file:

```toml
[settings]
durable_global_event_queue = true
```

The queue is disabled by default and cannot be enabled by a repository's
`rig.toml`. Changes made through `/configure` apply to the running daemon, and
disabling the queue leaves already queued events intact.

Authenticated daemon clients can inspect this setting with `GET /config` and
change it immediately with `PATCH /config` using
`{ "settings": { "durableGlobalEventQueue": true } }`. They can read event
batches from `GET /events`, follow live updates from `GET /events/stream`, and
acknowledge synced entries with `POST /events/trim` and a JSON body such as
`{ "through": 42 }`. Batch entries contain a global numeric `cursor` and the
original session `event`; the SSE stream uses the same cursor as its event ID.
`after` resumes either endpoint, and `limit` controls batch size. Events remain
queued until trimmed, and trimming the global queue does not remove per-session
history. See the [event reference](EVENTS.md) for every session event, its
payload, and its global queue behavior.

### Long-running commands

Codex `exec_command` now yields a live session when a command outlasts its wait
window; `write_stdin` can poll it, send input, or interrupt it. Claude `Bash`
honors `run_in_background`, with `TaskOutput` for later results and `TaskStop`
for cancellation. These commands retain the session's permission and sandbox
mode instead of escaping into an unmanaged process.

### MCP tool servers

Rig discovers tools from MCP servers when a workspace first runs. Servers can
be configured in Codex's global `~/.codex/config.toml` or project-local
`.codex/config.toml`. Rig's `~/.config/rig/config.toml` and local `rig.toml`
use the same tables and take precedence when both define a server:

```toml
[mcp_servers.docs]
command = "docs-mcp-server"
args = ["--stdio"]
tool_timeout_sec = 30

[mcp_servers.issues]
url = "https://example.com/mcp"
bearer_token_env_var = "ISSUES_MCP_TOKEN"

[mcp_servers.legacy]
url = "https://example.com/sse"
transport = "sse"

[mcp_servers.machine_api]
url = "https://example.com/mcp"
oauth_client_id_env_var = "MCP_CLIENT_ID"
oauth_client_secret_env_var = "MCP_CLIENT_SECRET"
oauth_scopes = ["tools.read", "tools.call"]
```

Use `/mcp` in the terminal to check connection failures, capabilities, and
discovered tool counts. MCP tools,
resources, resource templates, prompts, pagination, form elicitation, bearer
authentication, and OAuth client credentials are supported. Live
`list_mcp_tools` and `call_mcp_tool` access lets a session use tools added after
startup without restarting. OAuth is supported for streamable HTTP; legacy SSE
does not support OAuth.

Only configure servers you trust. Stdio servers are local processes that receive
the daemon environment and are not restricted by the session filesystem sandbox.

### Token usage and status

Use `/usage` to see provider-reported input, output, cache-read, cache-write, and
total processed tokens for the current session. `/configure` can enable a compact
context-usage status below the input, similar to Codex. The same line shows active
background subagents and managed shell processes while they are running.

## Publishing

Authenticate with npm once using `pnpm login`, then publish from a clean, up-to-date
`main` branch with a single command:

```sh
pnpm release 0.1.0
```

The release command also accepts semantic version bumps such as `patch`, `minor`,
and `major`. It checks npm authentication, runs the type checks and tests, builds
the package, creates the release commit and tag, previews the package contents,
pushes the release to `main`, publishes it publicly, and verifies the published
version. If publishing is interrupted after the tag is pushed, rerun the command
with the exact version to resume safely.

## License

MIT License - see [LICENSE](LICENSE) for details.
