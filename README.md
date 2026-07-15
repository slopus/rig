<div align="center">

<p><img src="./logo.png" alt="Rig" width="400" /></p>

<h3>The best of Pi, Codex, and Claude Code—unified in one coding-agent harness.</h3>

<p>
  Use Rig interactively in your terminal, run it headlessly, or integrate through
  its durable API. Built by the authors of
  <a href="https://github.com/slopus/happy">Happy</a> and
  <a href="https://github.com/slopus/happy2">Happy 2</a>.
</p>


https://github.com/user-attachments/assets/99a7dee6-36ef-4110-95b2-e236633640a4

<p>
  <a href="#quick-start">Quick start</a> ·
  <a href="#why-rig">Why Rig?</a> ·
  <a href="#how-rig-compares">Compare</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="DEVELOPMENT.md">Development</a>
</p>

</div>

Rig is an open-source coding-agent harness built on top of
[Pi](https://github.com/earendil-works/pi)'s foundations. It recreates the best
parts of [Codex](https://github.com/openai/codex) and
[Claude Code](https://code.claude.com/docs/en/overview) in one consistent local
runtime: the right prompts and tools for each model, useful defaults, safe
execution, durable sessions, subagents, MCP, and a friendly terminal interface.

The result is one harness that works well on its own and exposes a stable layer
for future client integrations. Apps can integrate once instead of maintaining
a different adapter for every coding agent.

## Quick start

### Step 1: Install Rig

```sh
npm install -g @slopus/rig
```

### Step 2: Sign in to the agents you want to use

Rig does not have another account to create. Run Codex or Claude Code once and
complete its normal sign-in:

```sh
codex
claude
```

Rig then uses the credentials already managed by those installations.

### Step 3: Start building

```sh
cd your-project
rig
```

Ask for what you want in plain English. Rig can inspect the repository, edit
files, run commands, delegate work, and verify the result. Use `/model` at any
time to choose an available model.

## Why Rig?

Pi is a wonderfully small, flexible foundation. Codex and Claude Code each add
excellent model-specific behavior, but they expose different tools, permissions,
session models, and integration protocols. Rig brings those ideas together
without making you rebuild the setup for every model, machine, or repository.

- **Feels native to the model.** GPT receives Codex-style prompts and tools;
  Claude receives Claude Code-style prompts and tools.
- **One dependable workflow.** Sessions, permissions, MCP, Docker, background
  commands, reviews, goals, and headless execution work through one interface.
- **Thoughtful defaults.** A fresh install is useful immediately, while global
  and project-local configuration remain available when you need them.
- **Ready for other clients.** A local daemon, persisted sessions, and a durable
  event stream let terminal, mobile, and web clients build on the same runtime.
- **Open and local.** Rig is MIT licensed, runs beside your code, and keeps its
  execution boundaries visible.

And the name? We asked GPT-5.6 Sol for something short and easy to type on a
keyboard. It suggested **Rig**.

## How it works

Rig is not a thin command alias and it does not pretend every model is the same.
It shares a common runtime while preserving the behavior each model expects.

| Layer               | Foundation                             | What Rig adds                                                                                     |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Model and streaming | Pi's provider and streaming primitives | Curated Codex, Claude SDK, and optional Amazon Bedrock routes                                     |
| Terminal experience | Pi's terminal UI primitives            | A stable activity timeline, permissions, session controls, background work, and polished defaults |
| GPT behavior        | Codex                                  | Codex-aligned prompts, tools, planning, collaboration, sandbox reviews, code review, and rewind   |
| Claude behavior     | Claude Code                            | Claude-aligned prompts, tools, tasks, subagents, background commands, and structured questions    |
| App integration     | Rig's local daemon and protocol        | Durable sessions and lifecycle events that can be consumed by external clients                    |

## How Rig compares

Rig is a unifying harness, not a replacement for every surface offered by Pi,
Codex, or Claude Code. This table focuses on the local coding-agent experience.

|                        | Rig                                                                   | [Pi](https://github.com/earendil-works/pi)                   | [Codex](https://github.com/openai/codex)  | [Claude Code](https://code.claude.com/docs/en/overview) |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------- |
| Primary role           | Opinionated multi-model harness                                       | Minimal, highly extensible agent toolkit                     | OpenAI's native coding agent              | Anthropic's native coding agent                         |
| Model access           | Codex, Claude SDK, and optional Bedrock models                        | Broad multi-provider catalog                                 | OpenAI models                             | Claude models, including supported cloud platforms      |
| Authentication         | Reuses Codex and Claude Code credentials                              | Pi logins or provider API keys                               | ChatGPT sign-in or API key                | Claude sign-in, API, or supported cloud provider        |
| Tool behavior          | Switches between model-native Codex and Claude toolsets               | Small generic core, replaceable with extensions              | Codex-native                              | Claude Code-native                                      |
| Subagents              | Built in, with provider-aligned controls and saved transcripts        | Intentionally extension-driven                               | Built-in multi-agent tools                | Built-in subagents and agent teams                      |
| Permissions            | Unified Auto, Workspace write, Read only, and Full access modes       | Intentionally extension- or container-driven                 | Native approvals and sandboxing           | Native permission modes                                 |
| MCP                    | Built-in stdio, streamable HTTP, and legacy SSE support               | Available through extensions                                 | Built in                                  | Built in                                                |
| Long-running work      | Managed shells, workflows, persistent goals, and background subagents | Intentionally uses external tools such as tmux or extensions | Background commands and multi-agent work  | Background commands, tasks, and agents                  |
| Headless and embedding | Text, JSON, streaming JSON, daemon protocol, and durable events       | Print, JSON, RPC, and a TypeScript SDK                       | Non-interactive mode, SDK, and app server | Print mode and Agent SDK                                |
| Best fit               | One local harness across model families and client apps               | Building a deeply customized agent                           | The first-party OpenAI experience         | The first-party Anthropic experience                    |

Rig deliberately keeps Pi's strong foundations and extensibility, then chooses a
cohesive built-in experience where Pi prefers a minimal core. From Codex and
Claude Code it adopts widely useful workflows, not every product-specific edge
case.

## Everyday commands

Type `/` in the terminal to see the commands available in the current session.

| Command        | What it does                                           |
| -------------- | ------------------------------------------------------ |
| `/model`       | Choose the model and reasoning level                   |
| `/permissions` | Choose filesystem, shell, and network access           |
| `/agents`      | See delegated work and open a child transcript         |
| `/tasks`       | See the current Claude-style task list                 |
| `/goal`        | Start or manage a persistent long-running goal         |
| `/review`      | Review staged, unstaged, and untracked changes         |
| `/mcp`         | Check MCP servers, capabilities, and connection errors |
| `/workflows`   | Open the live workflow monitor                         |
| `/ps`          | List managed background terminals                      |
| `/compact`     | Summarize older messages and free context space        |
| `/usage`       | Show provider-reported token usage                     |
| `/configure`   | Change app settings                                    |

Press Escape while the session is idle to rewind to an earlier message. Rig puts
that prompt back in the composer without changing files in the working directory.

## Sessions and automation

### Headless execution

Use `rig exec` when you want an agent result without opening the terminal UI:

```sh
rig exec "Review the current changes"
printf 'Run the tests and fix failures' | rig exec
```

Use `--json` for one machine-readable result or `--stream-json` for newline-
delimited session events followed by the final result:

```sh
rig exec --json "Summarize this repository"
rig exec --stream-json "Run the test suite"
```

Headless runs are normal persisted sessions. Continue or branch from them later:

```sh
rig exec --last "Continue with the next issue"
rig exec --resume SESSION_ID "Try the alternative approach"
rig exec --last --fork "Explore a separate solution"
```

### Saved sessions

Use the picker to resume or fork work in the current directory. Add `--all` to
include sessions from other directories.

```sh
rig resume
rig resume --last
rig resume --all
rig fork --last
rig fork SESSION_ID
```

The model and provider can be changed between responses. Automatic compaction
keeps long conversations useful, and `/compact` is available whenever you want
to compact immediately.

### Persistent goals and code review

`/goal <objective>` starts work that can continue across multiple agent turns.
Use `/goal` to check it, `/goal pause`, `/goal resume`, or `/goal clear` to manage
it. Goals survive daemon restarts and resumed sessions.

`/review` performs a read-only review of staged, unstaged, and untracked changes.
Add a focus when useful, for example `/review focus on concurrency`.

## Permissions

New sessions start in **Workspace write** mode. Change the current session with
`/permissions`:

| Mode                | Behavior                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Auto**            | Runs routine workspace work immediately and reviews risky actions automatically, asking when needed        |
| **Workspace write** | Allows edits in the working directory while blocking shell network access and writes outside the workspace |
| **Read only**       | Keeps project files read only while allowing temporary shell output                                        |
| **Full access**     | Allows unrestricted filesystem, shell, and network access                                                  |

Auto mode evaluates the current action against the user's request. It does not
build a permanent command allowlist. Sensitive escalation requests receive a
one-call review and fail closed when the review is unavailable or malformed.

Set the default globally or for a repository:

```toml
[defaults]
permission_mode = "workspace_write"
```

`RIG_PERMISSION_MODE` can override the default for a new terminal session with
`auto`, `workspace_write`, `read_only`, or `full_access`.

## Configuration

Rig reads user-wide settings from `~/.config/rig/config.toml` and repository
settings from `rig.toml`. Repository values win where both are allowed. It also
understands Codex MCP entries from `~/.codex/config.toml` and `.codex/config.toml`.

A small project configuration might look like this:

```toml
[defaults]
permission_mode = "workspace_write"

[features]
workflows = true

[theme]
brand = "ansi:202"
accent = "cyan"
```

Use `/configure` for common settings. Environment variables such as `RIG_MODEL`,
`RIG_PROVIDER`, `RIG_EFFORT`, and `RIG_PERMISSION_MODE` override the corresponding
default for a newly created session.

<details>
<summary><strong>Docker-backed sessions</strong></summary>

Connect Rig to a running container:

```sh
rig --docker-container my-development-container --docker-workdir /workspace
```

Or create a session container from an image already present in Docker:

```sh
rig --docker-image my-project-dev:local \
  --docker-workdir /workspace \
  --docker-env NODE_ENV=development \
  --docker-mount .:/workspace
```

The same options work with `rig exec`. `--docker-socket`, `--docker-name`, and
repeated `--docker-env` or `--docker-mount` options provide additional control.
Use `--local` to ignore a configured Docker default for one new session.

Machine-wide Docker defaults belong in `~/.config/rig/config.toml`:

```toml
[docker]
image = "my-project-dev:local"
workdir = "/workspace"
env = { NODE_ENV = "development" }
mounts = [
  { source = ".", target = "/workspace" },
  { source = "/Users/me/.cache/my-project", target = "/cache", read_only = true },
]
```

Relative mount sources resolve from the host directory where Rig starts. Use
absolute paths for home-directory mounts; `~` is not expanded. Repository
`rig.toml` files cannot select Docker images, sockets, environment variables, or
host mounts.

Image-backed containers are created on the first message and keep a stable,
session-derived name so their files survive daemon restarts. Rig never pulls an
image implicitly and leaves managed containers in place for you to remove with
Docker. Images and connected containers need `/bin/sh`, `readlink`, and common
POSIX file utilities.

</details>

<details>
<summary><strong>MCP servers</strong></summary>

Rig supports local stdio servers, streamable HTTP, and legacy SSE:

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
```

MCP tools, resources, resource templates, prompts, pagination, form elicitation,
bearer tokens, and OAuth client credentials are supported. Live tool discovery
lets a session use tools added after startup. OAuth is available for streamable
HTTP, but not legacy SSE.

Only configure servers you trust. Stdio servers run as local processes, receive
the daemon environment, and are not restricted by the session filesystem
sandbox.

</details>

<details>
<summary><strong>Amazon Bedrock</strong></summary>

Bedrock becomes available when the daemon starts with an
`AWS_BEARER_TOKEN_BEDROCK` value:

```sh
export AWS_BEARER_TOKEN_BEDROCK="your Bedrock API key"
export AWS_REGION="us-east-1"
export RIG_PROVIDER="bedrock"
rig
```

Rig uses `AWS_REGION`, then `AWS_DEFAULT_REGION`, and otherwise defaults to
`us-east-1`. Restart an already-running daemon after changing these variables.
The available model list follows AWS regional availability.

</details>

<details>
<summary><strong>Theme and display</strong></summary>

Rig follows Codex-style terminal color semantics by default. Override individual
roles globally or per repository:

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

Roles accept `default`, `dim`, ANSI names such as `bright_cyan`, palette indexes
such as `ansi:202`, or true-color values such as `#D97706`. `/fast` toggles the
Codex fast service tier when the selected provider supports it; fast inference
uses twice the plan usage.

</details>

<details>
<summary><strong>Workflows and app event synchronization</strong></summary>

Workflows are on by default. Disable them globally or per repository:

```toml
[features]
workflows = false
```

For client integrations, the daemon can keep an opt-in durable queue of session
and subagent lifecycle events:

```toml
[settings]
durable_global_event_queue = true
```

This setting is user-wide only. Authenticated daemon clients can read event
batches from `GET /events`, follow `GET /events/stream`, and acknowledge entries
with `POST /events/trim`. See the [event reference](EVENTS.md) for payloads and
queue behavior.

</details>

## Scope

Rig aims for the best common coding-agent workflows, not exhaustive parity with
every upstream option. It intentionally keeps planning in the normal agent flow,
uses standard terminal editing instead of modal editing, follows Codex skill
semantics, and relies on the existing Codex and Claude Code login flows.

Rig also draws a clear boundary around the terminal UI. The terminal is for a
focused, linear agent workflow. Features that need a richer interaction model—
such as drag-and-drop, multiple independently scrolling panes, or complex visual
workspaces—belong in a dedicated UI built on Rig's durable API. Rig provides the
harness; it does not squeeze desktop-app interactions into a terminal.

It does not add a separate Plan mode, Vim mode, notebook editor, durable command
allow/deny history, dedicated IDE integration, or a separate Rig account. These
boundaries keep the harness understandable and the defaults strong.

## Development and contributing

Want to work on Rig itself? See [DEVELOPMENT.md](DEVELOPMENT.md) for repository
setup, tests, architecture notes, and the release process.

## License

Rig is available under the [MIT License](LICENSE).
