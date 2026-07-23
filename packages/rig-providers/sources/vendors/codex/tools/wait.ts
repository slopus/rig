import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const wait = {
    name: "wait",
    type: "local",
    description:
        "Waits on a yielded `exec` cell and returns new output or completion.\n- Use `wait` only after `exec` returns `Script running with cell ID ...`.\n- `cell_id` identifies the running `exec` cell to resume.\n- `yield_time_ms` controls how long to wait for more output before yielding again. Defaults to 10000 ms.\n- `max_tokens` limits how much new output this wait call returns. Defaults to 10000 tokens.\n- `terminate: true` stops the running cell; false or omitted waits for output.\n- `wait` returns only the new output since the last yield, or the final completion or termination result for that cell.\n- If the cell is still running, `wait` may yield again with the same `cell_id`.\n- If the cell has already finished, `wait` returns the completed result and closes the cell.",
    parameters: Type.Object(
        {
            cell_id: Type.String({ description: "Identifier of the running exec cell." }),
            max_tokens: Type.Optional(
                Type.Number({
                    description:
                        "Output token budget for this wait call. Defaults to 10000 tokens.",
                }),
            ),
            terminate: Type.Optional(
                Type.Boolean({
                    description:
                        "True stops the running exec cell; false or omitted waits for output.",
                }),
            ),
            yield_time_ms: Type.Optional(
                Type.Number({
                    description: "Wait before yielding more output. Defaults to 10000 ms.",
                }),
            ),
        },
        { additionalProperties: false },
    ),
} as const satisfies SessionTool;
