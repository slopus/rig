import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const kill_command_or_subagent = {
    name: "kill_command_or_subagent",
    type: "local",
    description:
        "Terminate a running background task, monitor, or subagent.\n\nUsage notes:\n- Pass its task_id (a monitor's task_id is returned by monitor).\n- Sends SIGTERM/SIGKILL to a bash task or monitor; sends Cancel+Shutdown to a subagent.\n- Returns success if the task was killed or had already exited.",
    parameters: Type.Object(
        {
            task_id: Type.String({
                description: "The task ID to terminate",
            }),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "KillTaskToolInput",
            description:
                "Input for the `kill_task` tool — terminates a running background task,\nmonitor, or subagent by id.",
        },
    ),
} as const satisfies SessionTool;
