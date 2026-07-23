import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const spawn_subagent = {
    name: "spawn_subagent",
    type: "local",
    description:
        "Start a subagent that works on a task independently and reports back.\n\nAgent types:\n\n- **general-purpose**: General purpose agent for multi-step tasks. Has access to all tools: run_terminal_command, read_file, search_replace, list_dir, grep, web_search, and todo_write.\n- **explore**: Fast, read-only agent specialized for codebase exploration. Read-only — has access to: read_file, list_dir, grep.\n- **plan**: Software architect for planning implementation strategies. Read-only — has access to all tools except file editing (search_replace is not available): read_file, list_dir, grep, web_search, and todo_write.\n\n## Usage notes\n- When the agent is done, it returns a single message with its agent ID. Use that ID to resume the agent later for follow-up work.\n- background: Returns immediately with a subagent_id. Use get_command_or_subagent_output to retrieve results. This is set to true by default.\n- Subagents receive a compacted version of project instructions (AGENTS.md). If the task requires detailed conventions (e.g., build rules, testing patterns), include the relevant rules directly in the prompt.\n- When using the spawn_subagent tool, you must specify a subagent_type parameter to select which agent type to use.\n\nResuming a previous agent (resume_from):\n- Use resume_from to continue a previously completed subagent's conversation. Pass the subagent_id returned by a prior spawn_subagent call. A resumed agent keeps its full transcript and tool state, so you only need to describe what changed since the last run — don't re-explain the original task.\n- The resumed agent must use the same subagent_type as the source.\n\nIsolation mode:\n- Use isolation to control the child's execution environment. With \"worktree\", the child runs in an isolated git worktree whose edits don't affect the parent workspace; the worktree is preserved after completion and its path is returned in the output.\n\nIf the user explicitly asks for the model of a subagent/task, you may ONLY use model slugs from this list:\n- grok-4\n- grok-4.5\n\nIf the user does not explicitly request a model, omit `model` to inherit the parent model.",
    parameters: Type.Object(
        {
            prompt: Type.String({
                description: "The full task prompt for the subagent to execute.",
            }),
            description: Type.String({
                description: "Short description of the task (3-5 words).",
            }),
            subagent_type: Type.Optional(
                Type.String({
                    description:
                        'Name of the subagent type to launch. Built-in types: "general-purpose", "explore", "plan". Additional user-defined types may also be available.',
                    default: "general-purpose",
                }),
            ),
            background: Type.Optional(
                Type.Boolean({
                    description:
                        "Returns immediately with a subagent_id. Use the task output tool to retrieve results. This is set to true by default.",
                    default: true,
                }),
            ),
            capability_mode: Type.Optional(
                Type.Unsafe({
                    description:
                        'Capability mode: "read-only", "read-write", "execute", or "all". Controls which tool classes the child can use. Default is determined by the role.',
                    type: ["string", "null"],
                    enum: ["read-only", "read-write", "execute", "all", null],
                    default: null,
                }),
            ),
            isolation: Type.Optional(
                Type.Unsafe({
                    description:
                        'Isolation mode: "none" (default, shared workspace) or "worktree" (isolated git worktree). Worktree mode prevents the child\'s edits from affecting the parent workspace until explicitly merged.',
                    type: ["string", "null"],
                    enum: ["none", "worktree", null],
                }),
            ),
            resume_from: Type.Optional(
                Type.Unsafe({
                    description:
                        "Resume from a previously completed subagent's conversation. Pass the subagent_id returned by a prior task call. The new subagent continues the previous one's raw transcript with the new task prompt appended. The source must be completed (not running), belong to the current session, and use the same subagent_type.",
                    type: ["string", "null"],
                }),
            ),
            cwd: Type.Optional(
                Type.Unsafe({
                    description:
                        'Explicit working directory for the subagent. The path must exist and be a directory. Mutually exclusive with isolation="worktree". Ignored when resume_from is set (the resumed child inherits its source\'s cwd/worktree).',
                    type: ["string", "null"],
                }),
            ),
            model: Type.Optional(
                Type.Unsafe({
                    description:
                        "Optional model slug for this agent. If provided, it must resolve to one of the available model slugs. If omitted, the subagent uses the same model as the parent agent. Do not pass if resume_from is set (prior model will be used). Only choose an explicit model when the user directly requests it.",
                    type: ["string", "null"],
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "TaskToolInput",
            description:
                "Input for the `task` tool — launches a subagent to handle a task\nautonomously.",
        },
    ),
} as const satisfies SessionTool;
