# ohmypi

ohmypi is an opinionated fork of pi for people who want a strong default coding-agent experience without rebuilding the same setup on every machine and in every repo.

The goal is simple: make the useful parts of modern coding harnesses available out of the box, while still letting each project opt in, opt out, or tune behavior when it needs to.

## Why this exists

Using pi directly can mean repeating the same configuration work everywhere:

- copying prompt files between machines
- wiring up vendor-specific tool definitions
- deciding which sandboxing settings are safe for each workflow
- maintaining subagents, workers, and automation scripts by hand
- tuning prompts and tools separately for different inference providers
- remembering which projects should use which setup

That gets in the way when the real goal is to open a repo and have a good agent experience immediately. ohmypi packages that baseline so the default is useful, portable, and consistent.

## What ohmypi provides

ohmypi stays close to pi and to upstream vendor behavior, but adds a curated default layer:

- Vendor-aligned tool definitions, kept close to the provider contracts instead of inventing unnecessary abstractions.
- Simplified system prompts that are easier to reason about and reuse.
- Per-model and per-vendor prompt/tool optimizations, so different inference providers can work well without forcing users into one stack.
- Bundled subagents for common coding workflows.
- Background workers for longer-running or asynchronous tasks.
- Workflow presets for repeated engineering operations.
- Auto mode for hands-off execution when a project allows it.
- Sandboxing defaults that make local execution practical while keeping controls visible.
- Per-project enable/disable behavior, so teams can use ohmypi where it helps and leave other repos untouched.

## Design principles

ohmypi is intentionally opinionated, but not locked down:

- Good defaults first. A fresh install should already feel usable.
- Provider flexibility. The harness should work across proprietary and open source models.
- Project-local control. Repos should be able to enable, disable, or override behavior without changing global machine state.
- Close to upstream. Tool definitions and model expectations should track vendor semantics closely.
- Less ceremony. Common agent features should not require a custom setup ritual on every machine.

## Intended experience

Install ohmypi once, open a project, and get a capable coding harness with prompts, tools, subagents, workflows, workers, automation, and sandboxing already wired together.

When a project needs different behavior, configure it locally. When a machine changes, avoid rebuilding the whole setup from memory. When an inference provider changes, keep the same project workflow and let ohmypi handle the provider-specific differences where possible.

## Development

This is a single-package TypeScript project. Source files live in `sources/`, with `sources/main.ts` as the CLI entry point.

```sh
pnpm install
pnpm run check
pnpm test
pnpm run build
```

## License

MIT License - see [LICENSE](LICENSE) for details.
