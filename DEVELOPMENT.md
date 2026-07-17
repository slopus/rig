# Developing Rig

Thanks for helping improve Rig. This guide contains the repository-specific
setup, testing, and release details that contributors need. For product usage
and configuration, start with the [README](README.md).

## Repository layout

Rig is a pnpm TypeScript workspace.

- `packages/rig` contains the published `@slopus/rig` CLI, agent runtime, and
  local daemon. Its entry point is `packages/rig/sources/main.ts`.
- `packages/rig-dev` contains the private live-source `rig-dev` launcher.
- `packages/gym` contains the host-side end-to-end harness, PTY integration,
  fixtures, and Docker image definition.
- `packages/gym-tests` contains black-box terminal scenarios that exercise the
  built Rig agent in fresh containers.
- `scripts` contains repository release automation.

Shared TypeScript and code-quality configuration lives at the workspace root.
Root commands run the relevant package scripts.

## Setup

Install dependencies from the repository root:

```sh
pnpm install
```

Start the development CLI in its own terminal:

```sh
pnpm dev
```

To make the development CLI available as `rig-dev` from any directory, link its
private package once:

```sh
pnpm link:dev
```

Use `pnpm unlink:dev` to remove the global link. The released `rig` command is
unaffected because the two commands come from separate packages.

Both development commands run live source from this checkout. They keep their
daemon socket, token, logs, registry, and session database in the checkout's
ignored `.rig-dev` directory while using the directory where `rig-dev` was
invoked as the session workspace. They do not reuse or replace the installed
Rig daemon. When runtime source changes, the CLI fingerprints it and asks before
restarting an older workspace daemon.

## Validation

Run these checks separately from the repository root:

```sh
pnpm run check
pnpm test
pnpm run build
pnpm run format:check
pnpm run lint
```

Use a check that is proportionate to the change, and run all relevant checks
before publishing.

## End-to-end gym

The gym runs the built Rig CLI and daemon through a real PTY in a fresh Docker
container. Only inference is mocked; shell processes, tools, files, daemon
behavior, terminal rendering, interruption, and concurrency are real.

Read [packages/gym-tests/README.md](packages/gym-tests/README.md) before creating
or debugging a gym test. It is the source of truth for prerequisites,
`createGym`, fixtures, terminal snapshots, scroll tracking, targeted commands,
and cleanup.

Run the complete suite with:

```sh
pnpm test:gym
```

For a behavior regression, first reproduce the failure in
`packages/gym-tests/tests`, then make the same scenario pass without weakening
it. Name scenarios for the behavior they prove, interact at the terminal
boundary, wait for observable state instead of sleeping, and dispose every gym
instance.

## Provider reference sources

Local reference implementations live in `~/Developer/coding-assistant-sources`,
including the Codex and Claude Code source trees. Consult them when implementing
or comparing provider-aligned behavior. Preserve the useful model-facing
semantics while adapting them to Rig's simpler product model.

Pi packages are used as foundations for model streaming and the terminal UI.
Rig intentionally layers a curated experience on top instead of mirroring every
Pi customization mechanism.

## Code organization

Favor one function per file when adding or reshaping source code. Keep all
user-facing strings human-readable, and translate protocol values or internal
identifiers into natural English before rendering them.

For terminal work, treat the visible transcript as append-only. Update an
existing activity row in place when its state changes, and move completed live
work into history without making the composer jump.

## Publishing

Authenticate with npm once:

```sh
pnpm login
```

From a clean, current `main` branch, publish with:

```sh
pnpm release 0.1.0
```

The release command also accepts `patch`, `minor`, or `major`. It verifies npm
authentication, runs type checks and tests, builds the package, creates the
release commit and tag, previews the package contents, pushes the release to
`main`, publishes it publicly, and verifies the published version.

If publishing is interrupted after the tag is pushed, rerun the command with
the exact version to resume safely.
