# Third-party notices

## OpenAI Codex

This package contains a macOS Seatbelt base policy and Linux Bubblewrap policy adapted from
[OpenAI Codex](https://github.com/openai/codex).

Copyright 2025 OpenAI

OpenAI Codex is licensed under the Apache License, Version 2.0. The policies
are modified to preserve Rig's workspace metadata and daemon control paths
while using Rig's shared permission modes. See `LICENSE-CODEX` for the full
license text.

## Kimi Code

This package contains prompt text and model-facing tool descriptions adapted
from [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code).

Copyright (c) 2026 Moonshot AI

Kimi Code is licensed under the MIT License. The provider is modified to use
Rig's shared tools, permissions, sessions, and terminal instead of the Kimi Code
CLI, and intentionally omits upstream-only Plan, Cron, and AgentSwarm surfaces.
A copy of the license is included as `LICENSE-KIMI-CODE`.

## Grok Build

This package contains prompt text and model-facing tool descriptions adapted
from [xai-org/grok-build](https://github.com/xai-org/grok-build).

Copyright 2023-2026 SpaceXAI

Grok Build is licensed under the Apache License, Version 2.0. These portions
are modified to run through Rig's shared tools, permissions, sessions, and
terminal instead of the Grok Build TUI. See `LICENSE-GROK-BUILD` for the full
license text.
