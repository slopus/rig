# Rig TODO

This file tracks known defects, verified coverage gaps, and concrete follow-up work. Keep confirmed product defects separate from harness debt and residual risks.

## Product defects

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
    - Identify the exact output/render sequence that changes the terminal viewport; preserve the visible anchor until the user explicitly returns to live output.
    - Keep resize-induced scrollback inflation as a related but distinct defect.

- [ ] Render messages submitted during active inference as queued, not as durable history.
    - Match Codex ordering above the composer: live activity, active agents/workflows/background terminals, messages pending submission, composer.
    - Do not append a normal user timeline entry until the queued turn actually begins and the model receives it.
    - Cover messages submitted locally and through session-backed events or another client.

- [x] Prevent Escape from dropping a prompt during queue-to-run transition.
    - The queue retains ownership through asynchronous turn startup and removes the prompt only immediately before `agent.send()`.
    - Escape during skill refresh restores the prompt to the composer, and an unchanged Gym scenario resubmits it successfully.

- [ ] Make suspended subagents resumable after daemon restart.
    - Suspension can persist `status = suspended` together with a non-null active run ID.
    - Startup repair then changes the session to `error`, causing `resume_agent` to reject it.
    - Add persistence coverage for suspension while inference or a tool delays abort.

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
