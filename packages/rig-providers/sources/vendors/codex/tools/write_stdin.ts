import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const write_stdin = {
    name: "write_stdin",
    type: "local",
    description: "Writes characters to an existing unified exec session and returns recent output.",
    parameters: Type.Object(
        {
            session_id: Type.Number({
                description: "Identifier of the running unified exec session.",
            }),
            chars: Type.Optional(
                Type.String({
                    description:
                        "Bytes to write to stdin. Defaults to empty, which polls without writing.",
                }),
            ),
            max_output_tokens: Type.Optional(
                Type.Number({
                    description:
                        "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.",
                }),
            ),
            yield_time_ms: Type.Optional(
                Type.Number({
                    description:
                        "Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
