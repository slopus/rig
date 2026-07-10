# rig

rig is an opinionated fork of pi for people who want a strong default coding-agent experience without rebuilding the same setup on every machine and in every repo.

The goal is simple: make the useful parts of modern coding harnesses available out of the box, while still letting each project opt in, opt out, or tune behavior when it needs to.

## Why this exists

Using pi directly can mean repeating the same configuration work everywhere:

- copying prompt files between machines
- wiring up vendor-specific tool definitions
- deciding which sandboxing settings are safe for each workflow
- maintaining subagents, workers, and automation scripts by hand
- tuning prompts and tools separately for different inference providers
- remembering which projects should use which setup

That gets in the way when the real goal is to open a repo and have a good agent experience immediately. rig packages that baseline so the default is useful, portable, and consistent.

## What rig provides

rig stays close to pi and to upstream vendor behavior, but adds a curated default layer:

- Vendor-aligned tool definitions, kept close to the provider contracts instead of inventing unnecessary abstractions.
- Simplified system prompts that are easier to reason about and reuse.
- Per-model and per-vendor prompt/tool optimizations, so different inference providers can work well without forcing users into one stack.
- Bundled subagents for common coding workflows.
- Provider-aligned task planning with Codex `update_plan` and Claude's persistent task tools.
- Structured user questions with provider-aligned tools and terminal or web answer controls.
- MCP tool servers over stdio or streamable HTTP, with Codex- and Claude-compatible configuration.
- Background subagents with completion notifications and follow-up turns.
- Workflow presets for repeated engineering operations.
- Auto mode for hands-off execution when a project allows it.
- Automatic conversation compaction for long sessions, plus `/compact` when you want to free context space immediately.
- Sandboxing defaults that make local execution practical while keeping controls visible.
- Per-project enable/disable behavior, so teams can use rig where it helps and leave other repos untouched.

## Design principles

rig is intentionally opinionated, but not locked down:

- Good defaults first. A fresh install should already feel usable.
- Provider flexibility. The harness should work across proprietary and open source models.
- Project-local control. Repos should be able to enable, disable, or override behavior without changing global machine state.
- Close to upstream. Tool definitions and model expectations should track vendor semantics closely.
- Less ceremony. Common agent features should not require a custom setup ritual on every machine.

## Intended experience

Install rig once, open a project, and get a capable coding harness with prompts, tools, subagents, workflows, workers, automation, and sandboxing already wired together.

When a project needs different behavior, configure it locally. When a machine changes, avoid rebuilding the whole setup from memory. When an inference provider changes, keep the same project workflow and let rig handle the provider-specific differences where possible.

## Development

This is a single-package TypeScript project. Source files live in `sources/`, with `sources/main.ts` as the CLI entry point.

```sh
pnpm install
pnpm run check
pnpm test
pnpm run build
```

The build also compiles the Vite-powered web UI from `web_sources/` into `dist/web`.
After building, start it with:

```sh
pnpm run web
```

The `web` command starts or reuses the local daemon, serves the SPA, proxies `/api/*`
to the daemon socket, and routes the app through Portless at
`https://web.rig.localhost`.

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
the Claude SDK without changing its model ID. The web model picker exposes each
available provider/model combination explicitly.

The curated Claude, Kimi, and GLM models use the native Bedrock Runtime endpoint.
GPT-5.4 and GPT-5.5 use Bedrock Mantle's OpenAI Responses endpoint through the
official OpenAI Node SDK's `BedrockOpenAI` client because AWS does not serve those
models through Bedrock Runtime. The Kimi catalog includes Kimi K2.5 and Kimi K2
Thinking; the GLM catalog includes GLM 5, GLM 4.7, and GLM 4.7 Flash. Model
visibility is limited by AWS's regional availability; for example, Kimi K2.5 is
currently offered only in `us-east-1`, `us-east-2`, and `us-west-2`. Restart an
already-running daemon after changing these environment variables.

For web UI development with Vite hot reload, run the daemon and frontend separately:

```sh
pnpm dev daemon start
pnpm dev:web
```

Open the Vite URL printed by `pnpm dev:web`, usually `http://127.0.0.1:5173`.
The Vite dev server proxies `/api/*` to the local daemon socket.

### Permission modes

New sessions start in **Workspace write** mode. File tools can edit the working
directory, while shell writes outside it and shell network access are blocked.
Git metadata and temporary files remain writable so normal development commands
continue to work.

Use `/permissions` in the terminal or the Permissions control in the web
inspector to switch the current session and its subagents between:

- **Workspace write** — write in the working directory with shell network access blocked.
- **Read only** — keep project files read only; shell commands may write temporary files.
- **Full access** — allow unrestricted filesystem, shell, and network access.

Set the terminal default in global or project-local `rig.toml`:

```toml
[defaults]
permission_mode = "workspace_write"
```

`RIG_PERMISSION_MODE` overrides the configured default for a newly created
terminal session. Accepted values are `workspace_write`, `read_only`, and
`full_access`.

### Task tracking

Claude sessions use the current `TaskCreate`, `TaskGet`, `TaskUpdate`, and
`TaskList` tools. Tasks, dependencies, and progress survive daemon restarts and
are shared with the session's subagents. Use `/tasks` in the terminal or the
Tasks section in the web inspector to see the current list.

### Background subagents

Claude sessions can set `run_in_background` on the `Agent` tool and use
`SendMessage` for follow-up work. Codex sessions use `spawn_agent`,
`followup_task`, `wait_agent`, `list_agents`, and
`interrupt_agent`. Each child keeps its own persisted conversation, reports a
completion notification to its parent, and can receive more work without losing
context. Use `/agents` in the terminal or Delegated work in the web inspector to
see current status and open a child transcript.

Team/swarm coordination, remote agents, and automatic worktree isolation are
intentionally outside this core workflow.

### MCP tool servers

Rig discovers tools from MCP servers when a workspace first runs. Codex-style
servers can be configured globally in `~/.config/rig/config.toml` or locally in
`rig.toml`:

```toml
[mcp_servers.docs]
command = "docs-mcp-server"
args = ["--stdio"]
tool_timeout_sec = 30

[mcp_servers.issues]
url = "https://example.com/mcp"
bearer_token_env_var = "ISSUES_MCP_TOKEN"
```

Claude-style project configuration is also supported in `.mcp.json`:

```json
{
    "mcpServers": {
        "docs": {
            "type": "stdio",
            "command": "docs-mcp-server",
            "args": ["--stdio"]
        }
    }
}
```

Use `/mcp` in the terminal or the MCP servers section in the web inspector to
check connection failures and discovered tool counts. Restart the daemon after
changing MCP configuration. OAuth, legacy SSE transports, MCP prompts, and MCP
resources are not yet supported.

Only configure servers you trust. Stdio servers are local processes that receive
the daemon environment and are not restricted by the session filesystem sandbox.

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
