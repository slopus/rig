# Agent Instructions

## Product direction

Build the best combined coding-agent experience from Codex and Claude Code, with a strong focus on simplicity, thoughtful defaults, and a polished user experience. Prioritize important, widely useful workflows over obscure features or exhaustive parity.

## Deliberate non-goals

Do not implement a dedicated Plan mode, Vim or other modal editing modes, or niche compatibility features whose primary value is exhaustive upstream parity. Planning should remain part of the normal agent workflow. Only reconsider these boundaries when the user explicitly changes the product direction.

## Reference sources

Coding-agent source trees are located at `~/Developer/coding-assistant-sources`. Use the Codex and Claude Code sources there as the implementation reference whenever adding, comparing, or updating provider-aligned behavior. Adapt their strongest ideas to rig's simpler product model instead of copying complexity that does not improve the experience.

## Package manager

Always use `pnpm` for this project. Do not use `npm`, `npx`, or `yarn` for installs, scripts, dependency changes, or lockfile updates unless the user explicitly asks for a different package manager.

## Code organization

Favor one function per file when adding or reshaping source code.

## User-facing text

All strings displayed to users must be human-readable English. Prefer natural, human-like labels and messages over raw identifiers, internal enum values, file names, protocol names, or placeholder text. Convert technical values into clear display text before rendering them in the UI or CLI.

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
