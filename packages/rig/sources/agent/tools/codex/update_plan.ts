import { Type } from "@sinclair/typebox";

import { defineTool } from "../../types.js";
import { textOutputSchema, toTextBlocks } from "../../../tools/utils/index.js";

const planItemSchema = Type.Object(
    {
        step: Type.String({ description: "Task step text." }),
        status: Type.Union(
            [Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")],
            { description: "Step status." },
        ),
    },
    { additionalProperties: false },
);

const executorPlanItemSchema = Type.Object(
    {
        step: Type.String({ description: "Task step text." }),
        status: Type.Unsafe({
            type: "string",
            description: "Step status.",
            enum: ["pending", "in_progress", "completed"],
        }),
    },
    { additionalProperties: false },
);

export const codexUpdatePlanTool = defineTool({
    name: "update_plan",
    label: "update_plan",
    description: `Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.`,
    executorTool: {
        name: "update_plan",
        description:
            "Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time.\n",
        parameters: Type.Object(
            {
                explanation: Type.Optional(
                    Type.String({ description: "Optional explanation for this plan update." }),
                ),
                plan: Type.Array(executorPlanItemSchema, { description: "The list of steps" }),
            },
            { additionalProperties: false },
        ),
    },
    arguments: Type.Object(
        {
            explanation: Type.Optional(
                Type.String({ description: "Optional explanation for this plan update." }),
            ),
            plan: Type.Array(planItemSchema, { description: "The list of steps." }),
        },
        { additionalProperties: false },
    ),
    returnType: textOutputSchema,
    shouldReviewInAutoMode: () => false,
    execute: async ({ plan }) => {
        const activeSteps = plan.filter((item) => item.status === "in_progress").length;
        if (activeSteps > 1) {
            throw new Error("A plan can have at most one step in progress.");
        }
        return { text: "Plan updated" };
    },
    toLLM: toTextBlocks,
    toUI: (_result, { plan }) => {
        const completed = plan.filter((item) => item.status === "completed").length;
        const active = plan.filter((item) => item.status === "in_progress").length;
        const pending = plan.filter((item) => item.status === "pending").length;
        return `Plan updated: ${completed} completed, ${active} in progress, ${pending} pending`;
    },
    locks: ["update_plan"],
});
