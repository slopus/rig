# Third-party notices

## Happy

Rig's Happy authentication, encrypted session transport, and session-envelope
mapping are adapted from [Happy](https://github.com/slopus/happy).

Copyright (c) 2026 Happy Coder Contributors

Happy is licensed under the MIT License. The integration is modified to use
Rig's daemon, durable sessions, shared permission model, and terminal UI.

## OpenAI Codex

Rig's macOS Seatbelt base policy and Linux Bubblewrap policy are adapted from
[OpenAI Codex](https://github.com/openai/codex).

Copyright 2025 OpenAI

OpenAI Codex is licensed under the Apache License, Version 2.0. The policies
are modified to preserve Rig's workspace metadata and daemon control paths
while using Rig's shared permission modes. A copy of the license is distributed
in the published package as `LICENSE-CODEX`.

## Kimi Code

Rig's Kimi provider contains prompt text and model-facing tool descriptions
adapted from [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code).

Copyright (c) 2026 Moonshot AI

Kimi Code is licensed under the MIT License. The provider is modified to use
Rig's shared tools, permissions, sessions, and terminal instead of the Kimi Code
CLI, and intentionally omits upstream-only Plan, Cron, and AgentSwarm surfaces.
A copy of the license is distributed in the published package as
`LICENSE-KIMI-CODE`.

## Grok Build

Rig's Grok provider contains prompt text and model-facing tool descriptions
adapted from [xai-org/grok-build](https://github.com/xai-org/grok-build).

Copyright 2023-2026 SpaceXAI

Grok Build is licensed under the Apache License, Version 2.0. The provider is
modified to run through Rig's shared tools, permissions, sessions, and terminal
instead of the Grok Build TUI. A copy of the license is distributed in the
published package as `LICENSE-GROK-BUILD`.
