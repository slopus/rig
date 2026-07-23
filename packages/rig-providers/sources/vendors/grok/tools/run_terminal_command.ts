import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const run_terminal_command = {
    name: "run_terminal_command",
    type: "local",
    description:
        "Run a bash command and return its output.\n\nUsage notes:\n  - You can specify an optional timeout in milliseconds (up to 36000000ms). If not specified, commands exceeding the default timeout will be automatically backgrounded instead of killed. You will receive a task id to check output later.\n  - Timeout enforcement: when the timeout fires, the wrapper kills the child process group (SIGTERM, escalated to SIGKILL after a ~1s grace period). Descendants that did not detach via `setsid` / `nohup` will also be killed. `timeout: 0` in `background: true` mode disables the wrapper timeout entirely; the child's lifetime is owned by the model via kill_command_or_subagent.\n  - If the output exceeds 40000 characters, output will be truncated before being returned to you.\n  - You can use the background parameter to run the command in the background (e.g., dev servers, long builds): it returns a task id immediately and keeps running in the background. You are notified on completion, so do not poll or sleep-wait for it. You do not need to use '&' at the end of the command when using this parameter.",
    parameters: Type.Object(
        {
            command: Type.String({
                description: "The bash command to run.",
            }),
            timeout: Type.Optional(
                Type.Unsafe({
                    description:
                        "Optional timeout in milliseconds (max 36000000). Default: 120000. If not specified, commands exceeding the default timeout will be automatically backgrounded. `timeout: 0` in background mode disables the wrapper timeout entirely; the task runs until it exits or is killed via the kill task tool.",
                    type: ["integer", "null"],
                    format: "uint64",
                    minimum: 0,
                    default: 120000,
                    maximum: 36000000,
                }),
            ),
            description: Type.String({
                description:
                    "One sentence explanation as to why this command needs to be run and how it contributes to the goal.",
            }),
            background: Type.Optional(
                Type.Boolean({
                    description:
                        "Set to true for long-running commands that should run in the background (e.g., dev servers, long builds). Returns a task id immediately while the command keeps running in the background; you are notified on completion, so do not poll or sleep-wait for it.",
                    default: false,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "BashToolInput",
            description: "Input for the bash/terminal command tool.",
        },
    ),
} as const satisfies SessionTool;
