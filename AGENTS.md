# Agent Instructions

## Package manager

Always use `pnpm` for this project. Do not use `npm`, `npx`, or `yarn` for installs, scripts, dependency changes, or lockfile updates unless the user explicitly asks for a different package manager.

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
