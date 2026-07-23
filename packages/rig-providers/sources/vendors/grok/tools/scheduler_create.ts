import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const scheduler_create = {
    name: "scheduler_create",
    type: "local",
    description:
        'Create a scheduled task that runs a prompt on a recurring interval, or update an existing one in place.\n\nSet fire_immediately: true to also fire once on creation; by default the first run waits for the interval.\n\nTo change an existing task, pass its task_id: provided fields replace old values, omitted ones are unchanged, and the schedule keeps its phase. An unknown id errors.\n\nUsage notes:\n- Interval format: "5m" (minutes), "2h" (hours), "1d" (days), "60s" (seconds, min 60)\n- Maximum 50 scheduled tasks at once\n- Tasks auto-expire after 7 days\n- For one-time delayed work, run a background terminal command (e.g. `sleep 1800 && <command>`) instead; its completion notifies you',
    parameters: Type.Object(
        {
            task_id: Type.Optional(
                Type.Unsafe({
                    description:
                        "Id of an existing task to update in place: provided fields replace old values, omitted ones are unchanged, the schedule keeps its phase, and an unknown id errors. Omit to create a task.",
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            interval: Type.Optional(
                Type.Unsafe({
                    description:
                        'Interval between executions, e.g. "5m", "2h", "1d". Required to create; optional with task_id',
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            prompt: Type.Optional(
                Type.Unsafe({
                    description:
                        "The prompt text to execute on each scheduled fire. Required to create; optional with task_id",
                    type: ["string", "null"],
                    default: null,
                }),
            ),
            durable: Type.Optional(
                Type.Unsafe({
                    description:
                        "Whether the task persists across sessions. Default: false. Create-only: ignored with task_id",
                    type: ["boolean", "null"],
                    default: null,
                }),
            ),
            foreground: Type.Optional(
                Type.Unsafe({
                    description:
                        "Run each fire as a main-conversation turn instead of a background subagent; set true only when runs need the conversation's context. Default: false. Create-only: ignored with task_id",
                    type: ["boolean", "null"],
                    default: null,
                }),
            ),
            fire_immediately: Type.Optional(
                Type.Boolean({
                    description:
                        "Whether to fire immediately on creation (true) or wait for the first interval (false). Default: false. Create-only: ignored with task_id",
                    default: false,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "SchedulerCreateInput",
            required: [],
        },
    ),
} as const satisfies SessionTool;
