# Rig TODO

This file tracks known defects, verified coverage gaps, and concrete follow-up work. Keep confirmed product defects separate from harness debt and residual risks.

## Product defects

- [x] Generate a conservative session title and recap after the session settles.
    - A structured metadata call runs after one idle minute with no foreground, subagent, workflow, or background-terminal work.
    - User activity and renewed work restart settlement, while revision tokens and aborts discard stale generation results.
    - Bounded real-user and final-visible-assistant context drives a 2–6 word title and short recap; existing titles are retained unless clearly misleading.
    - Both values persist, the resume picker shows the recap, and fake-clock plus real session/resume Gym coverage protects the flow.

- [x] Render the completed-turn elapsed time below the assistant output.
    - The immutable `Worked for …` row replaces the live status below the completed response without moving earlier transcript content.
    - Unit coverage handles tool-only, queued, error, and interrupted endings; a real multi-tool Gym regression verifies final response, timer, and composer ordering.

- [x] Render blocked MCP servers as structured child rows.
    - `MCP servers blocked` remains the parent while humanized server names and reasons render beneath it with stable child indentation.
    - Exact wide/narrow assertions and a two-server Gym regression cover wrapping, width bounds, input order, and immutable transcript behavior.

- [ ] Simplify nested terminal layouts to a single final child connector.
    - Replace continuous `│` rails in wrapped tool output and subagent/status lists with one `└` connector at the start of the child block; align later wrapped lines with spaces.
    - Apply the same visual grammar to tool output, `/agents`, blocked MCP servers, and other parent-with-children rows without changing durable event grouping.
    - Add exact wide/narrow rendering assertions and real Gym screenshots for tool and agent layouts.

- [x] Dedent pending steering messages by one terminal cell.
    - The pending heading and single-connector child block render one cell left with an `(esc to send now)` hint at normal and narrow widths.
    - Escape with pending messages interrupts, promotes every message exactly once, and immediately continues; without pending messages it stops interaction normally.
    - Double Escape clears the draft into local history, and Up/Down cycles submitted messages and cleared drafts for editing.
    - Real PTY regressions cover the original message-loss path, exact row positions, immediate continuation, and input-history behavior.

- [ ] Show active agents first with elapsed time and token usage.
    - Sort `/agents` with running, waiting, and suspended agents before completed agents while retaining stable ordering within each group.
    - Show current elapsed time and cumulative model tokens for active agents; persist and show final elapsed time and total tokens for completed agents and completion notices.
    - Use human-readable compact values and include nested descendants without double-counting usage.
    - Add protocol/persistence coverage plus a real parent/subagent Gym scenario for live and completed states.

- [ ] Support a trusted machine-level permission ceiling.
    - Let machine/runtime configuration cap selectable session modes, including a ceiling of Auto that forbids Full access.
    - Enforce the ceiling server-side for creation, protocol changes, spawn, restore, and descendants; filter forbidden modes from the UI.
    - Keep project configuration unable to raise or define the ceiling.

- [x] Align Auto-mode reviews with Codex risk thresholds, including MCP actions.
    - Trusted MCP tools are available in Auto and use the same per-action reviewer as shell and host-access tools.
    - Low- and medium-risk work proceeds without redundant approval; narrowly scoped high-risk work proceeds only with clear user authorization.
    - Successful reviews stay out of tool history while denied or approval-required actions remain visible.
    - Added a 16-case live Codex eval covering routine development, this session's false positives, MCP reads and mutations, unauthorized remote effects, destructive work, and secret export.

- [x] Fix stale background-terminal completion events after session resume.
    - Resuming a session can append a burst of `Background terminal completed` rows for terminals that completed in earlier runs.
    - Determine why restored/yielded process state is reconciled as a new transition; fix the persisted lifecycle or initial reconciliation rather than hiding completion rows in the TUI.
    - Added a Gym regression that resumes a real persisted session and verifies historical terminals are not reannounced after attachment.

- [ ] Fix forced scroll-to-bottom without a terminal resize.
    - Reproduce while the user is reading upper or middle scrollback and ordinary live state changes occur.
    - Confirmed triggers include copying selected historical text with Cmd-C and receiving streamed assistant output while the user remains scrolled up.
    - Gym must hold a middle historical viewport across streaming chunks, live status changes, background completion, and copy-key input, asserting both exact visible rows and scroll offset remain unchanged.
    - The ordinary-prose Gym baseline preserves exact rows and offset, but native selection/Cmd-C is outside the harness and the reported real-terminal jump remains unmodeled. Keep the general issue open.
    - Markdown-table streaming had a separate exact cause: repeated whole-table reflow made the mutable live tail exceed the viewport. In-progress table rendering is now height-bounded, and the table Gym regression preserves its historical anchor through streaming and background completion.
    - Identify the exact output/render sequence that changes the terminal viewport; preserve the visible anchor until the user explicitly returns to live output.
    - Keep resize-induced scrollback inflation as a related but distinct defect.

- [x] Prevent interrupted assistant text from being duplicated in the transcript.
    - Interrupted stream finalization now reuses the live transcript entry instead of appending its partial text again.
    - Gym interrupts after observable streamed text and verifies one exact fragment before the durable `Session interrupted` row.

- [x] Render messages submitted during active inference as queued, not as durable history.
    - Steering acknowledgements now move local and remote messages from pending UI into durable history only when the agent loop consumes them.
    - Gym verifies pending-message ordering beside active work and proves both clients' messages become durable exactly once after consumption.

- [x] Prevent Escape from dropping a prompt during queue-to-run transition.
    - The queue retains ownership through asynchronous turn startup and removes the prompt only immediately before `agent.send()`.
    - Escape during skill refresh restores the prompt to the composer, and an unchanged Gym scenario resubmits it successfully.

- [x] Make suspended subagents resumable after daemon restart.
    - Startup repair finalizes and clears a stale active run while preserving `status = suspended`.
    - The parent receives a durable passive notification that delegated work stopped at restart and will not resume automatically.
    - Gym restarts the real daemon, verifies no child inference runs on startup, and recovers only after the parent calls `resume_agent`.

- [x] Bound MCP rendering work before serializing and wrapping large payloads.
    - MCP tool text and protocol metadata now stop at a 512 KiB budget, image payloads and block counts are capped, and structured content uses bounded traversal.
    - Large-array, oversized-image, resource-content, and structured-payload regressions prove rendering stops before walking the full value.

- [x] Enforce the inference retry boundary at low-level transport failures before response content.
    - Retry typed socket, DNS, and Undici failures plus exact fetch, WebSocket, and incomplete-stream transport errors.
    - Do not retry generic `terminated`, HTTP 408/429/5xx, provider retry guidance, or failures after text, thinking, or tool-call events.
    - A zero-content continuation after a completed tool may retry; Gym verifies the completed tool runs once.

- [ ] Deduplicate visible provider error rows.
    - A terminal inference failure such as HTTP 503 currently renders the same durable `Error` row twice.
    - Reconcile provider-error and run-error events so one failure produces one append-only transcript row without hiding distinct nested causes.
    - Add a real Gym regression with an exact error-row count.

- [x] Apply the same transport-before-content policy to standalone compaction summaries.
    - Main-loop and compaction requests share the classifier, content boundary, retry budget, and backoff.
    - Gym verifies safe standalone recovery and no retry after partial summary text.

- [ ] Fix daemon-shutdown persistence races.
    - Shutdown can close the database while `PersistentSessionStore.saveSession()` is still running, producing `database is not open`.
    - Track and drain run cleanup, title/recap generation, workflows, and subagent notifications before closing SQLite; reject new mutations once shutdown begins.

- [ ] Handle local daemon replacement without crashing stale TUI clients.
    - When another Rig process restarts the daemon and rotates its token, an existing client's SSE reconnect receives HTTP 401 and the unhandled watcher rejection terminates Node with a raw stack trace.
    - Stop affected watchers and exit cleanly with a human-readable message that the local daemon restarted and Rig must reconnect; do not present this as a provider authentication failure.
    - Add a real Gym regression that replaces the daemon beneath an active TUI and verifies the session remains resumable without a raw exception.

- [x] Fix transcript-preserving resize behavior while reading scrollback.
    - Resize notifications settle for 75 ms, then one full redraw clears Rig-owned scrollback and rebuilds from canonical transcript entries at the final size.
    - The TUI defers input and activity renders during the resize quiet period instead of replaying intermediate dimensions.
    - Gym starts from historical scrollback and verifies the chosen history anchor remains exactly once, with the same total row count as a fresh render at the final dimensions.

## Documentation and consistency

- [x] Update `AGENTS.md` terminal-layout guidance.
    - It still requires an in-place mutable background polling row, but empty polling is now deliberately live-tail-only with no history row.

- [ ] Document external API effects of expanded public types.
    - External TypeScript consumers must implement the expanded `FileSystemContext` interface and required `RigConfig.theme` fields.

## Gym and test harness

- [x] Buffer OSC 10/11 terminal color queries across PTY chunks.
    - The helper currently detects only complete query sequences contained in one write.
    - Add split-sequence unit coverage.

- [x] Align screenshot renderer defaults with the emulated terminal colors.
    - PNG defaults differ from the foreground/background advertised by the Ghostty helper.
    - Add direct renderer unit coverage; normal Gym runs currently exercise screenshots only when an environment variable is set.

- [x] Replace remaining timing-sensitive Gym scenarios with deferred gates.
    - Permission timing should not require observing the exact string `(2s · esc to interrupt)`.
    - Automatic compaction should not rely on a three-second response delay to queue a prompt.
    - Background polling should not rely on a three-second shell lifetime while later phases are manually gated.

- [x] Strengthen foreground shell history coverage.
    - The test claims the command renders once but currently checks only containment; count exact `Ran` rows.

- [x] Reduce oversized terminal snapshots.
    - Several snapshots serialize every glyph and absolute cell coordinate, creating 457–644-line fixtures with high incidental churn.
    - Prefer semantic row assertions plus normalized style runs.

- [x] Resolve intentional ANSI-regex lint warnings in test helpers.
    - Four tests currently trigger `no-control-regex`; use a shared ANSI stripping helper or a scoped rule suppression.

## Residual verification risks

- [ ] Add real-container coverage for Docker filesystem rollback and metadata restoration.
- [ ] Exercise MCP multi-block application errors across live stdio and HTTP transports with both providers.

---

## Backlog captured at the July 14 pause

- [ ] Expand `/usage` into a session and plan-usage dashboard.
    - Keep current provider token totals, then add session cost, API and wall duration, lines added/removed, current context usage, and provider-reported reset windows where available.
    - Show current-session, weekly all-model, and model-specific progress bars with local timezone reset labels; mark unavailable provider data clearly instead of estimating it as fact.
    - Add an explicitly approximate local contribution section based only on persisted sessions on this machine, including high-context usage guidance without claiming it covers other devices or provider web clients.
    - Preserve a compact narrow-terminal layout and add provider-available/provider-unavailable screenshots plus deterministic rendering tests.
    - On every new or resumed session, show one compact provider-specific quota line with the remaining percentage in the current five-hour window and a plain-language countdown to reset, for example `Codex usage: 68% left · resets in 2h 14m`.
    - Keep the startup/resume line to one terminal row where possible, reflow cleanly at narrow widths, and omit it when the selected provider cannot report authoritative five-hour-window data.
    - Refresh the displayed quota when the provider/model changes and when a completed response returns newer limit metadata.
    - Require real Gym/provider-boundary screenshots for new session, resumed session, narrow width, provider change, and unavailable usage data.

- [ ] Show compaction progress and refresh context state.
    - Inspect the pinned Codex implementation first, then show a compact live compaction message with a progress bar while automatic or manual compaction is running.
    - Settle that live message into immutable transcript history when compaction finishes, preserving the existing compaction notice and adding human-readable elapsed time without moving older rows or jumping the composer.
    - Refresh the footer/status context usage from the authoritative post-compaction conversation state immediately after compaction; verify main sessions and each subagent track their own current context without stale parent/child values.
    - Remove the redundant `· main [default]` footer segment for the main agent; retain agent/model identity only where it distinguishes a subagent or a non-default selection.
    - Add deterministic state/rendering coverage and real Gym screenshots for live compaction progress, settled elapsed history, post-compaction context usage, narrow width, and main-versus-subagent footers.

- [ ] Wrap long lines in edit previews.
    - Inspect the pinned Codex implementation first, then make Rig edit/apply-patch previews wrap to the available terminal width instead of clipping or overflowing.
    - Preserve diff markers, indentation, syntax coloring, and readable continuation alignment at narrow widths.
    - Add exact narrow-width rendering coverage and a real Gym screenshot before implementation is considered complete.

- [ ] Tighten collapsed output for long commands.
    - Remove two additional retained middle lines around the `… +N lines` collapse marker so long command output stays easier to scan.
    - Preserve the command header, useful leading/trailing context, exact omitted-line count, and single-`└` continuation grammar.
    - Add wide/narrow exact-row coverage and a real Gym screenshot; do not change the underlying command result or protocol payload.

- [x] React to system light/dark appearance changes during an active session.
    - Terminal palette notifications now re-query the effective background, re-resolve the configured theme, and force a settled full repaint including the composer.
    - Real-PTY Gym coverage verifies both light-to-dark and dark-to-light changes during an active session, including synchronized-output settlement and stale-surface removal.

- [ ] Plan and scope Podman support.
    - Identify the Docker-specific assumptions in Gym and normal Rig workflows, then define the smallest useful portability target before implementation.

- [x] Consolidate long-running background-terminal status.
    - Active tools, subagents, workflows, and background terminals already render as one compact count-based row per category in the live tail.
    - Empty polling remains live-only while durable start and completion history is preserved.

- [x] Add an optional terminal-completion chime.
    - The opt-in chime fires once when delayed title/recap settlement completes after foreground and session-owned background work becomes idle.
    - Session-event replay never chimes; a real resume regression verifies the live-only boundary.

- [ ] Explore cmux integration.
    - Identify the high-value session, pane, and background-terminal workflows before choosing an integration surface.

## Nice to have

- [ ] Support starred (favorite) models.
    - Let users star models, persisted in the config file, and surface starred models first in the model picker.
    - Ship factory-default favorites so users who never customize still get a good curated set; a user override in config replaces the defaults.
    - Consider indicating which providers the user is logged into (and which are unavailable) in the model picker, so starred-but-unauthenticated models are not a dead end.
