import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const get_command_or_subagent_output = {
    name: "get_command_or_subagent_output",
    type: "local",
    description:
        "Get output and status from a background task, monitor, or subagent.\n\nUsage notes:\n- Pass task_ids with one or more ids from background=true commands or background=true subagents (a monitor's task_id is returned by monitor); for a single task use a one-element array. Multiple ids with a positive timeout_ms wait until all complete\n- Omit timeout_ms or pass 0 for a non-blocking status snapshot; set a positive timeout_ms to wait up to that many milliseconds, capped at ~10 min\n- Returns current output, status, and exit code if completed\n- If output is large, use read_file on the output_file path",
    parameters: Type.Object(
        {
            task_ids: Type.Optional(
                Type.Array(Type.String({}), {
                    description:
                        "Task IDs to get output from. Pass one or more; for a single task use a one-element array. With a positive timeout_ms, multiple ids wait until all complete. Omit timeout_ms or pass 0 for a non-blocking snapshot.",
                    default: [],
                }),
            ),
            timeout_ms: Type.Optional(
                Type.Unsafe({
                    description:
                        "Max wait time in milliseconds. A positive value waits for completion; omit or pass 0 for a non-blocking status poll.",
                    type: ["integer", "null"],
                    format: "uint64",
                    minimum: 0,
                    default: null,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "TaskOutputToolInput",
            description: "Input for the `get_task_output` tool.",
            required: [],
        },
    ),
} as const satisfies SessionTool;
