import { Type } from "@sinclair/typebox";

import type { SessionTool } from "@/core/SessionTool.js";

export const claude_task_update_tool: SessionTool = {
    name: "TaskUpdate",
    type: "local",
    description:
        'Use this tool to update a task in the task list.\n\n## When to Use This Tool\n\n**Mark tasks as resolved:**\n- When you have completed the work described in a task\n- When a task is no longer needed or has been superseded\n- IMPORTANT: Always mark your assigned tasks as resolved when you finish them\n- After resolving, call TaskList to find your next task\n\n- ONLY mark a task as completed when you have FULLY accomplished it\n- If you encounter errors, blockers, or cannot finish, keep the task as in_progress\n- When blocked, create a new task describing what needs to be resolved\n- Never mark a task as completed if:\n  - Tests are failing\n  - Implementation is partial\n  - You encountered unresolved errors\n  - You couldn\'t find necessary files or dependencies\n\n**Delete tasks:**\n- When a task is no longer relevant or was created in error\n- Setting status to `deleted` permanently removes the task\n\n**Update task details:**\n- When requirements change or become clearer\n- When establishing dependencies between tasks\n\n## Fields You Can Update\n\n- **status**: The task status (see Status Workflow below)\n- **subject**: Change the task title (imperative form, e.g., "Run tests")\n- **description**: Change the task description\n- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")\n- **owner**: Change the task owner (agent name)\n- **metadata**: Merge metadata keys into the task (set a key to null to delete it)\n- **addBlocks**: Mark tasks that cannot start until this one completes\n- **addBlockedBy**: Mark tasks that must complete before this one can start\n\n## Status Workflow\n\nStatus progresses: `pending` → `in_progress` → `completed`\n\nUse `deleted` to permanently remove a task.\n\n## Staleness\n\nMake sure to read a task\'s latest state using `TaskGet` before updating it.\n\n## Examples\n\nMark task as in progress when starting work:\n```json\n{"taskId": "1", "status": "in_progress"}\n```\n\nMark task as completed after finishing work:\n```json\n{"taskId": "1", "status": "completed"}\n```\n\nDelete a task:\n```json\n{"taskId": "1", "status": "deleted"}\n```\n\nClaim a task by setting owner:\n```json\n{"taskId": "1", "owner": "my-name"}\n```\n\nSet up task dependencies:\n```json\n{"taskId": "2", "addBlockedBy": ["1"]}\n```\n',
    parameters: Type.Object(
        {
            taskId: Type.String({ description: "The ID of the task to update" }),
            subject: Type.Optional(Type.String({ description: "New subject for the task" })),
            description: Type.Optional(
                Type.String({ description: "New description for the task" }),
            ),
            activeForm: Type.Optional(
                Type.String({
                    description:
                        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
                }),
            ),
            status: Type.Optional(
                Type.Union(
                    [
                        Type.Union([
                            Type.Literal("pending"),
                            Type.Literal("in_progress"),
                            Type.Literal("completed"),
                        ]),
                        Type.Literal("deleted"),
                    ],
                    { description: "New status for the task" },
                ),
            ),
            addBlocks: Type.Optional(
                Type.Array(Type.String(), { description: "Task IDs that this task blocks" }),
            ),
            addBlockedBy: Type.Optional(
                Type.Array(Type.String(), { description: "Task IDs that block this task" }),
            ),
            owner: Type.Optional(Type.String({ description: "New owner for the task" })),
            metadata: Type.Optional(
                Type.Object(
                    {},
                    {
                        description:
                            "Metadata keys to merge into the task. Set a key to null to delete it.",
                        propertyNames: { type: "string" },
                        additionalProperties: Type.Unknown(),
                    },
                ),
            ),
        },
        { additionalProperties: false },
    ),
};

export const claude_task_update_tool_sonnet: SessionTool = {
    name: "TaskUpdate",
    type: "local",
    description:
        'Use this tool to update a task in the task list.\n\n## When to Use This Tool\n\n**Mark tasks as resolved:**\n- When you have completed the work described in a task\n- When a task is no longer needed or has been superseded\n- IMPORTANT: Always mark your assigned tasks as resolved when you finish them\n- After resolving, call TaskList to find your next task\n\n- ONLY mark a task as completed when you have FULLY accomplished it\n- If you encounter errors, blockers, or cannot finish, keep the task as in_progress\n- When blocked, create a new task describing what needs to be resolved\n- Never mark a task as completed if:\n  - Tests are failing\n  - Implementation is partial\n  - You encountered unresolved errors\n  - You couldn\'t find necessary files or dependencies\n\n**Delete tasks:**\n- When a task is no longer relevant or was created in error\n- Setting status to `deleted` permanently removes the task\n\n**Update task details:**\n- When requirements change or become clearer\n- When establishing dependencies between tasks\n\n## Fields You Can Update\n\n- **status**: The task status (see Status Workflow below)\n- **subject**: Change the task title (imperative form, e.g., "Run tests")\n- **description**: Change the task description\n- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")\n- **owner**: Change the task owner (agent name)\n- **metadata**: Merge metadata keys into the task (set a key to null to delete it)\n- **addBlocks**: Mark tasks that cannot start until this one completes\n- **addBlockedBy**: Mark tasks that must complete before this one can start\n\n## Status Workflow\n\nStatus progresses: `pending` → `in_progress` → `completed`\n\nUse `deleted` to permanently remove a task.\n\n## Staleness\n\nMake sure to read a task\'s latest state using `TaskGet` before updating it.\n\n## Examples\n\nMark task as in progress when starting work:\n```json\n{"taskId": "1", "status": "in_progress"}\n```\n\nMark task as completed after finishing work:\n```json\n{"taskId": "1", "status": "completed"}\n```\n\nDelete a task:\n```json\n{"taskId": "1", "status": "deleted"}\n```\n\nClaim a task by setting owner:\n```json\n{"taskId": "1", "owner": "my-name"}\n```\n\nSet up task dependencies:\n```json\n{"taskId": "2", "addBlockedBy": ["1"]}\n```\n',
    parameters: Type.Object(
        {
            taskId: Type.String({ description: "The ID of the task to update" }),
            subject: Type.Optional(Type.String({ description: "New subject for the task" })),
            description: Type.Optional(
                Type.String({ description: "New description for the task" }),
            ),
            activeForm: Type.Optional(
                Type.String({
                    description:
                        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
                }),
            ),
            status: Type.Optional(
                Type.Union(
                    [
                        Type.Union([
                            Type.Literal("pending"),
                            Type.Literal("in_progress"),
                            Type.Literal("completed"),
                        ]),
                        Type.Literal("deleted"),
                    ],
                    { description: "New status for the task" },
                ),
            ),
            addBlocks: Type.Optional(
                Type.Array(Type.String(), { description: "Task IDs that this task blocks" }),
            ),
            addBlockedBy: Type.Optional(
                Type.Array(Type.String(), { description: "Task IDs that block this task" }),
            ),
            owner: Type.Optional(Type.String({ description: "New owner for the task" })),
            metadata: Type.Optional(
                Type.Object(
                    {},
                    {
                        description:
                            "Metadata keys to merge into the task. Set a key to null to delete it.",
                        propertyNames: { type: "string" },
                        additionalProperties: Type.Unknown(),
                    },
                ),
            ),
        },
        { additionalProperties: false },
    ),
};
