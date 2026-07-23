import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const workflow = {
    name: "workflow",
    type: "local",
    description:
        "Launch a workflow: a Rhai script that orchestrates subagents as one background run. Provide exactly one source: `name` (a registered workflow — built-in, or from the project `.grok/workflows/` or user `~/.grok/workflows/`), an inline `script`, or a `script_path`. Optionally pass `args` (bound to the script's `args`) and `agent_budget`, an absolute cap on cumulative child-agent calls: every agent() and parallel() item consumes one slot (schema retries do not); default 128. The call returns immediately; progress appears in `/workflows` and completion is reported automatically — do not poll or sleep-wait.\n\nPrefer a registered workflow when one fits; author a script for bounded fan-out over a known work list, staged research and verification, or several independent perspectives, and confirm unusually large fan-out first. Before writing or editing a script, read the `create-workflow` skill's SKILL.md. `validate_only: true` runs a path-specific smoke check (metadata, compile, one canned-host path) — not proof that every branch or live tool works.\n\nA started run gets a session-unique display name (e.g. `review-changes`, `review-changes-2`) — the handle to show the user and use with `/workflow pause|resume|stop <name>`; keep run IDs internal. Each launch persists an editable `script_path`; edit it and launch as a new run to iterate. Use `resume_from_run_id` only for a same-process paused run (process restarts are terminal); a budget-limited run resumes only with a higher `agent_budget`. Save reusable scripts to `.grok/workflows/<name>.rhai`.",
    parameters: Type.Object(
        {
            agent_budget: Type.Optional(
                Type.Unsafe({
                    description:
                        "Absolute cumulative cap on logical child-agent calls for this run. Every agent() and every parallel() item consumes one slot; schema retries do not. Defaults to 128 and may be set from 1 through 1,024. A panel that would exceed the remaining budget is rejected before any of its children launch.",
                    type: ["integer", "null"],
                    format: "uint64",
                    minimum: 1,
                    maximum: 1024,
                    default: null,
                }),
            ),
            name: Type.Optional(
                Type.Unsafe({
                    description:
                        "Name of a registered workflow (built-in, or discovered from the project `.grok/workflows/` or user `~/.grok/workflows/`). Exactly one of `name`, `script`, or `script_path` must be set.",
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            script: Type.Optional(
                Type.Unsafe({
                    description:
                        "Inline Rhai workflow script. It must start with a pure-literal `let meta = #{ name: ..., description: ... };` map. Before authoring, read the `create-workflow` skill's SKILL.md. Run the path-specific `validate_only` smoke check with representative args.",
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            script_path: Type.Optional(
                Type.Unsafe({
                    description: "Path to a .rhai workflow script on disk.",
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            args: Type.Optional(
                Type.Unknown({
                    description:
                        "JSON value bound to the script's `args` global. Use an object for named arguments.",
                    default: null,
                }),
            ),
            resume_from_run_id: Type.Optional(
                Type.Unsafe({
                    description:
                        "Resume a same-process paused run, continuing its original immutable script and args; do not also pass name, script, script_path, or args. A budget-limited run resumes only when agent_budget is passed with a higher cap. Process-restart interruptions are terminal.",
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            validate_only: Type.Optional(
                Type.Boolean({
                    description:
                        "Run a path-specific smoke check without launching: validate metadata, compile the full script, and execute the single path selected by the supplied args and canned host results. It does not exercise every branch or prove live tools and agent outputs work.",
                    default: false,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "WorkflowToolInput",
            required: [],
        },
    ),
} as const satisfies SessionTool;
