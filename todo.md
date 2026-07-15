# Rig TODO

This file tracks known defects, verified coverage gaps, and concrete follow-up work. Keep confirmed product defects separate from harness debt and residual risks.

## Product defects

- [ ] Generate a conservative session title and recap after the session settles.
    - Replace immediate first-message title generation with one structured title-and-recap call after the foreground agent stops, one minute passes without user input, and no subagent, workflow, or background terminal remains active.
    - Cancel or restart settlement on user activity or renewed work, and discard stale generation results with a revision token.
    - Send only a bounded set of recent real user messages and the final visible assistant text block from relevant turns; exclude tools, thinking, notifications, and intermediate stream deltas, with a marked partial fallback for interrupted turns.
    - Ask for a 2–6 word title and short recap, conservatively preserving the current title unless it has become clearly misleading.
    - Persist both values and show a one-line recap beneath each session in the resume picker.
    - Add fake-clock state-machine coverage and a real session/resume regression.

- [ ] Render the completed-turn elapsed time below the assistant output.
    - The immutable `Worked for …` row currently appears before the completed response.
    - Move it below that response, occupying the position where the live working status was, without moving earlier transcript content or making the composer jump.
    - Add a real Gym/PTTY regression that verifies final row ordering for normal, interrupted, and tool-using turns.

- [ ] Render blocked MCP servers as structured child rows.
    - Keep `MCP servers blocked` as the parent row, then render each humanized server name and reason below it with a fixed child indent like `/agents`.
    - Preserve stable wrapping, terminal-width bounds, input order, and immutable transcript behavior.
    - Add exact wide/narrow row assertions and a two-server real Gym regression.

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

- [ ] Bound MCP rendering work before serializing and wrapping large payloads.
    - Invocation arguments and result blocks currently process the full payload before display row limits apply.
    - Add byte/character bounds and a large-payload render performance regression.

- [ ] Decide and enforce the exact inference retry boundary.
    - The stated product rule is transport failures only and only before response content begins.
    - Current matching also retries generic `terminated`, HTTP 408/429/5xx, and provider “you can retry” messages.
    - Narrow ambiguous matches or update the documented policy after an explicit product decision.
    - Add negative coverage proving disconnects after text, tool calls, or session mutations never replay inference.
    - The observed zero-content `WebSocket error` after a completed tool now retries only the inference continuation; Gym verifies the tool runs once.

- [ ] Add retry handling or an explicit exception for standalone compaction summary requests.
    - `requestCompactionSummary()` currently throws directly and does not use the main inference-loop retry mechanism.

- [ ] Fix daemon-shutdown persistence races.
    - Shutdown can close the database while `PersistentSessionStore.saveSession()` is still running, producing `database is not open`.
    - Track and drain run cleanup, title/recap generation, workflows, and subagent notifications before closing SQLite; reject new mutations once shutdown begins.

- [x] Fix transcript-preserving resize behavior while reading scrollback.
    - Resize notifications settle for 75 ms, then one full redraw clears Rig-owned scrollback and rebuilds from canonical transcript entries at the final size.
    - The TUI defers input and activity renders during the resize quiet period instead of replaying intermediate dimensions.
    - Gym starts from historical scrollback and verifies the chosen history anchor remains exactly once, with the same total row count as a fresh render at the final dimensions.

## Documentation and consistency

- [x] Update `AGENTS.md` terminal-layout guidance.
    - It still requires an in-place mutable background polling row, but empty polling is now deliberately live-tail-only with no history row.

- [ ] Document external compatibility effects of expanded public types.
    - External TypeScript consumers must implement the expanded `FileSystemContext` interface and required `RigConfig.theme` fields.

## Gym and test harness

- [ ] Buffer OSC 10/11 terminal color queries across PTY chunks.
    - The helper currently detects only complete query sequences contained in one write.
    - Add split-sequence unit coverage.

- [ ] Align screenshot renderer defaults with the emulated terminal colors.
    - PNG defaults differ from the foreground/background advertised by the Ghostty helper.
    - Add direct renderer unit coverage; normal Gym runs currently exercise screenshots only when an environment variable is set.

- [ ] Replace remaining timing-sensitive Gym scenarios with deferred gates.
    - Permission timing should not require observing the exact string `(2s · esc to interrupt)`.
    - Automatic compaction should not rely on a three-second response delay to queue a prompt.
    - Background polling should not rely on a three-second shell lifetime while later phases are manually gated.

- [ ] Strengthen foreground shell history coverage.
    - The test claims the command renders once but currently checks only containment; count exact `Ran` rows.

- [ ] Reduce oversized terminal snapshots.
    - Several snapshots serialize every glyph and absolute cell coordinate, creating 457–644-line fixtures with high incidental churn.
    - Prefer semantic row assertions plus normalized style runs.

- [ ] Resolve intentional ANSI-regex lint warnings in test helpers.
    - Four tests currently trigger `no-control-regex`; use a shared ANSI stripping helper or a scoped rule suppression.

## Residual verification risks

- [ ] Add real-container coverage for Docker filesystem rollback and metadata restoration.
- [ ] Exercise MCP multi-block application errors across live stdio and HTTP transports with both providers.

---

## Backlog captured at the July 14 pause

- [x] React to system light/dark appearance changes during an active session.
    - Terminal palette notifications now re-query the effective background, re-resolve the configured theme, and force a settled full repaint including the composer.
    - Real-PTY Gym coverage verifies both light-to-dark and dark-to-light changes during an active session, including synchronized-output settlement and stale-surface removal.

- [ ] Plan and scope Podman support.
    - Identify the Docker-specific assumptions in Gym and normal Rig workflows, then define the smallest useful compatibility target before implementation.

- [x] Consolidate long-running background-terminal status.
    - Active tools, subagents, workflows, and background terminals already render as one compact count-based row per category in the live tail.
    - Empty polling remains live-only while durable start and completion history is preserved.

- [ ] Add an optional terminal-completion chime.
    - Emit one opt-in chime when delayed title/recap settlement completes, meaning foreground work and all session-owned background work are finished.
    - Never chime while replaying persisted history.

- [ ] Explore cmux integration.
    - Identify the high-value session, pane, and background-terminal workflows before choosing an integration surface.
