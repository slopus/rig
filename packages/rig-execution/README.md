# Rig execution

`Executor` is Rig's stable coding-model execution boundary. It owns configured native providers,
model profiles, base prompts, locked provider contracts, session compatibility, inference, and
compaction. Callers own tool definitions and implementations.

Callers select a provider and canonical Rig model ID, supply durable context and the tools for that
run, and consume execution events. An incompatible selection emits `reset_required` without
contacting a model; call `reset` to begin the new compatibility domain.
