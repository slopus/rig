import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const monitor = {
    name: "monitor",
    type: "local",
    description:
        "Start a background monitor that streams events from a long-running script. Each stdout line is an event - you can keep working and notifications arrive in the chat. Exit ends the watch.\n\n**Output volume**: Every stdout line becomes a message in the conversation, so write selective filters. In pipes use `grep --line-buffered` (plain `grep` buffers and delays events by minutes).\n\nSet `persistent: true` for session-length watches (PR monitoring, log tails) -- the monitor runs until you call kill_command_or_subagent or until the session ends. Otherwise it stops at `timeout_ms` (default 10h).",
    parameters: Type.Object(
        {
            command: Type.String({
                description:
                    "Shell command or script. Each stdout line is an event; exit ends the watch.",
            }),
            description: Type.String({
                description:
                    "Short human-readable description of what you are monitoring (shown in every notification).",
            }),
            timeout_ms: Type.Optional(
                Type.Unsafe({
                    description:
                        "Kill the monitor after this deadline (ms). Default: 36000000 (10 hr). Max: 36000000 (10 hr).",
                    type: ["integer", "null"],
                    format: "uint64",
                    minimum: 0,
                    default: 36000000,
                }),
            ),
            persistent: Type.Optional(
                Type.Boolean({
                    description:
                        "Run for the lifetime of the session (no timeout). Stop with kill_command_or_subagent.",
                    default: false,
                }),
            ),
        },
        {
            $schema: "http://json-schema.org/draft-07/schema#",
            title: "MonitorInput",
        },
    ),
} as const satisfies SessionTool;
