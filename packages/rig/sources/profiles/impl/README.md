# Model profiles

Each top-level TypeScript file is the single base profile for one vendor/model pair. The
retained profiles are:

- Claude: Fable 5, Opus 4.8, and Sonnet 5.
- Codex: GPT-5.6 Luna, Sol, and Terra.
- Grok: Grok 4.5, Grok Build, and Grok Composer 2.5 Fast.
- Kimi: K3.
- Z.ai: GLM-5 and GLM-4.7 Flash.

Amazon Bedrock does not create duplicate top-level profiles. Its Claude and GPT-5.6
transport variants are derived in `impl/bedrockModelProfileVariants.ts`; Z.ai profiles
already use Bedrock as their configured transport. Shared registries, types, resolvers,
renderers, and tests live under `impl/`. Client-specific prompts, appends, and patch notes
live under `claude/`, `codex/`, `grok/`, and `kimi/`.

Profiles contain the tool surface, prompt recipe, image handling, wire mode/model ID,
context and compaction limits, reasoning levels, output limits, service tiers, and any
available versioned client reference parameters. Differences from official clients are
source comments beside the relevant profile, prompt, tool, or transport code; they are
documentation, not runtime data structures.

## Prompt computation

`computeProfileSystemPrompt` starts with the captured or adapted original prompt, applies
ordered exact-match patches, then renders ordered appends separated by two newlines. A
stale patch fails closed. The shared `rig-runtime-model` append records the active model
and provider. Sol and Terra also own the conditional Codex Ultra append.

Normal prompt assembly adds runtime sections such as AGENTS.md, skills, permissions,
secrets, and caller-provided text afterward. An integration-owned exact `systemPrompt`
replaces the original and its patches; only appends explicitly marked for overrides,
currently Codex Ultra, remain. Durable-skill metadata is integration-owned and is still
appended when durable skills are configured.

## Source snapshots

- Codex GPT-5.6 prompts are extracted directly from the official
  `codex-rs/models-manager/models.json` source on `main` at commit
  `d4fcb2873bf23464cfacd804a31d46529db943b0`. The extractor requires a clean source
  checkout, verifies that the instructions template and personality variables do not add
  unresolved dynamic content, and fails closed when the source shape changes. Sol and
  Terra use v2 code-mode `exec`/`wait`/native `collaboration`, plus a separate
  provider-neutral `rig` namespace for workflows and cross-provider agent controls; Luna uses the v1
  spawn/send/resume/wait/close group. Each model's adjacent `*.capture.json`,
  `*.golden.md`, `*.md`, and `*.patch` files preserve the official input, computed Rig
  version, and unified diff. Run `pnpm --filter @slopus/rig capture:codex-profile` to
  regenerate them from `~/Developer/coding-assistant-sources/codex`, or
  `check:codex-profile` to verify byte stability without writing.
- Claude prompts and tool schemas are captured from the official `claude_code` presets in
  `@anthropic-ai/claude-agent-sdk` 0.3.201, which bundles Claude Code 2.1.201 at commit
  `5bb45156ece6b12214696c88adec695b2dca1338`. Capture requests the complete preset,
  identifies and tokenizes the dynamic working directory, Git state, platform, shell, and
  OS fields, and generates a full prompt template. Rig renders those
  fields from the active session before inference and caches the repository/environment
  snapshot for the conversation. Differential captures cover a different shell, an
  initialized Git repository, a linked worktree, and a project path long enough to exercise
  Claude Code's bounded path hash. Generation fails if any normalized request differs,
  exposing a new dynamic section instead of silently freezing it. The complete captured
  unsupported memory, hook, product-surface, and tool-specific instructions are removed
  by fail-closed transforms. Each model's adjacent `*.capture.json`, `*.golden.md`, `*.md`,
  `*.patch`, `*.tools.golden.json`, `*.tools.json`, and `*.tools.patch` files preserve the
  official input, computed Rig version, and unified diff. The computed prompt and tool
  definition files are loaded by the runtime. Run
  `pnpm --filter @slopus/rig capture:claude-profile` to update them or
  `check:claude-profile` to recapture and verify byte stability on the canonical capture
  platform. The proxy never forwards the deliberately blocked request upstream.
- Grok Build and Kimi prompts are Rig adaptations from unpinned upstream snapshots.
- No versioned Z.ai coding-client prompt was captured; those profiles use the shared
  runtime-model append only.

The golden tests lock captured prompt hashes, provenance, client tool lists, prompt patch
ordering, computed appends, retained provider catalogs, and Bedrock route coverage.
