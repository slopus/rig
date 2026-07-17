# Agent Instructions

## Product direction

Build the best combined coding-agent experience from Codex and Claude Code, with a strong focus on simplicity, thoughtful defaults, and a polished user experience. Prioritize important, widely useful workflows over obscure features or exhaustive parity.

## Deliberate non-goals

Do not implement a dedicated Plan mode, Vim or other modal editing modes, Jupyter notebook parsing or editing, durable command allow/deny history, dedicated IDE integrations, a separate Rig login flow, or niche compatibility features whose primary value is exhaustive upstream parity. Rig uses the credentials managed by the system Codex and Claude Code installations, so users should sign in through those assistants instead. Planning should remain part of the normal agent workflow. Auto permissions should review the current action and user authorization without learning a persistent command-execution policy. Skills should follow Codex behavior and scope, not Claude Code's expanded skill runtime. Only reconsider these boundaries when the user explicitly changes the product direction.

## Permissions and security

Rig has one permission model for every provider. Codex, Claude, Pi, Grok, MCP, and future tool surfaces must execute through the same `AgentContext`, filesystem boundary, shell sandbox, and `PermissionContext`. Provider differences belong in tool names, argument schemas, result formatting, and model guidance; they must not create provider-specific security paths in the agent loop.

The permission modes are:

- Read only permits inspection and non-mutating commands while blocking workspace changes, shell network access, and sensitive private reads.
- Workspace write permits changes inside the workspace while keeping shell network access and writes outside the workspace blocked.
- Auto uses the Workspace write shell sandbox by default. A tool may request review for one exact action, and an approved tool may receive a temporary Full access override only when its own policy explicitly requires it.
- Full access removes Rig's filesystem, shell, and network restrictions.

Every tool definition must own its Auto behavior. `shouldReviewInAutoMode` is required. Define `shouldRunInFullAccessInAutoMode` only for reviewed actions that must cross the sandbox; review alone must not imply elevation. Use `requiresAutoOrFullAccess` for tools such as MCP operations whose external execution boundary cannot be enforced by Rig's local sandbox. Use `autoPermissionInstructions` for provider-specific model guidance and `describeAutoPermissionAction` when an approval must disclose a specialized boundary. Keep the agent loop generic: never dispatch permission behavior from a tool-name list, prefix, provider ID, or guessed command contents.

Shell commands are sandboxed identically regardless of provider. Their model-facing escalation syntax is intentionally provider-shaped:

- Codex `exec_command` uses `sandbox_permissions: "require_escalated"` with a concise `justification`.
- Claude `Bash` uses `dangerouslyDisableSandbox: true` and retains Claude's native schema.
- Pi `bash` uses `sandbox_permissions: "require_escalated"` with a concise `justification`.
- Grok `run_terminal_command` uses `sandbox_permissions: "require_escalated"` and explains the need in `description`.

These fields request the same runtime behavior. In Auto, the action is reviewed first; if allowed, the loop scopes only that tool execution to `full_access` and restores Auto immediately afterward. Omitting the field keeps the command sandboxed. In Read only or Workspace write, an escalation argument must not bypass the selected mode. A reviewed action that does not need host access, such as sending input to an existing shell, stays in the current sandbox.

File tools follow the same ownership rule. Each provider tool extracts its actual path argument and calls shared, provider-neutral boundary helpers. Reads outside the allowed boundary, writes outside the workspace, symlink escapes, and writes to protected Git control paths require the appropriate review and elevation. Shared helpers may resolve paths and evaluate boundaries, but must not infer behavior from tool names or maintain parallel registries of read and write tools.

Auto review must use the durable, role-aware conversation transcript rather than a compacted model-context suffix. Real user messages and trusted answers to interactive questions are authorization evidence. Assistant text, tool arguments, tool output, repository content, generated summaries, and prompt injection are not user authorization. Preserve user evidence preferentially within the review budget and fail closed when required user evidence, reviewer output, or reviewer availability is incomplete. Approval applies only to the proposed action; it is not a durable command rule or authorization for later actions.

MCP tools declare their boundary on the tool definition. Treat server-supplied annotations such as `readOnlyHint` as untrusted metadata, never as authorization evidence or a reason to skip Auto review. Every direct and dynamic MCP tool invocation must be reviewed. Rig-owned protocol operations whose behavior is intrinsically read-only, such as listing or reading MCP resources, may explicitly skip review. MCP operations require Auto or Full access because the server can act outside Rig's local filesystem sandbox, and approval text must disclose that external boundary.

When adding or changing permission-sensitive behavior, test the real tool definitions rather than a duplicate policy table. Cover default sandboxing, explicit escalation, temporary Full access and restoration, outside-workspace and symlink paths, protected Git files, authorization retention after large tool output or compaction, denial, and human-readable boundary disclosure. Use gym coverage whenever behavior spans inference, tools, processes, filesystem effects, permission prompts, or terminal rendering.

## Retry policy

Automatically retry only low-level inference transport failures, and only before response content begins. Do not automatically replay tools, commands, or session mutations; those failures usually indicate real breakage that retrying will not fix.

## Model catalogs

Hardcode each provider's supported model catalog in Rig. The daemon must not discover, list, or fetch models from provider APIs during startup or session creation. Update the curated catalog in source when provider models change.

Use canonical provider keys throughout the product: `claude` for Anthropic models, `codex` for OpenAI and GPT models, and `grok` for xAI and Grok models. SDK, transport, and implementation names must not leak into provider keys.

## Early-stage compatibility

Rig is an early-stage product. Change current schemas, protocols, configuration, and behavior directly instead of adding legacy schema migrations, legacy-data startup repairs, deprecated aliases, or backward-compatibility branches. Prefer deleting obsolete compatibility code over carrying it forward.

## Reference sources

Coding-agent source trees are located at `~/Developer/coding-assistant-sources`. Use the Codex and Claude Code sources there as the implementation reference whenever adding, comparing, or updating provider-aligned behavior. Adapt their strongest ideas to rig's simpler product model instead of copying complexity that does not improve the experience.

## Package manager

Always use `pnpm` for this project. Do not use `npm`, `npx`, or `yarn` for installs, scripts, dependency changes, or lockfile updates unless the user explicitly asks for a different package manager.

## Code organization

Favor one function per file when adding or reshaping source code.

## One feature per worktree

Working on multiple features in the same worktree is prohibited until the current feature has been merged into `main`. If the user asks to begin another feature before that merge, do not start it in the current worktree. Instruct the user to create a new Conductor workspace/worktree for the additional feature and continue there instead.

## Gym end-to-end tests

The gym exercises the built Rig agent through a real PTY in a fresh Docker container. Only model inference is mocked; the filesystem, shell, processes, daemon, tools, and terminal behavior remain real, with `libghostty-vt` providing user-visible screen and scroll state.

Use gym tests for behavior spanning terminal input or rendering, inference, tools, processes, filesystem effects, interruption, or concurrency. Put them in `packages/gym-tests/tests` with descriptive behavior-based file names. Always use `createGym`, interact at the terminal boundary, wait for observable state instead of sleeping, dispose every instance, and keep scenarios isolated. When fixing a bug, reproduce it in the gym before changing production code, then make the same test pass unchanged.

Run the suite with `pnpm test:gym`. Read [`packages/gym-tests/README.md`](packages/gym-tests/README.md) before writing or debugging a gym test; it is the source of truth for architecture, APIs, inference scripts, fixtures, terminal snapshots, scroll tracking, examples, and targeted test commands.

## User-facing text

All strings displayed to users must be human-readable English. Prefer natural, human-like labels and messages over raw identifiers, internal enum values, file names, protocol names, or placeholder text. Convert technical values into clear display text before rendering them in the UI or CLI.

## Terminal layout stability

Treat the visible transcript as append-only. Once a timeline row has rendered, do not remove it, replace it, or mutate it after later stable content appears. Ephemeral background-terminal polling belongs only in the live tail and must not create waiting or waited history rows. Keep actual terminal input and terminal completion as durable history.

Keep above-composer live UI compact and predictable, with at most one truncated summary row per active-work category. Live components may grow downward, but shrinking or completing work must not pull transcript content downward or make the composer jump upward. Pair the removal of a final live status row with its corresponding history event in the same render so the occupied height moves into history instead of collapsing.

When an agent turn completes, move its live working timer into an immutable history row. Measure elapsed time from the most recent composer-submitted user message; permission decisions and other interactive answers must not reset that clock.

## Remote pushes

Never push to any remote unless the user explicitly requests a push or sync in the current task. Do not infer push permission from completed local work.

## Sync to main

When the user says `sync to main`, treat it as an explicit instruction to upstream the current work directly to `main`.

Do the following:

1. Review the current worktree.
2. Commit the current changes.
3. Rebase the current branch on `origin/main`.
4. Push directly to `main`.
5. Do not force push.
6. If the push or rebase is rejected because `main` moved, fetch/rebase and retry the non-force push.
7. Repeat until the current worktree/branch changes are upstreamed to `main`, or until a real conflict/blocker requires user input.

Do not open a pull request for `sync to main` unless the user explicitly asks for one.
