import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { requireSubagentContext } from "../impl/requireSubagentContext.js";
import { collaborationItemsSchema } from "./collaborationItemsSchema.js";
import { collaborationItemsToText } from "./collaborationItemsToText.js";

export const codexV1SendInputTool = defineTool({
    name: "send_input",
    label: "send_input",
    namespace: {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
    },
    description:
        "Send a plaintext message to an existing agent. Set interrupt to redirect it immediately.",
    arguments: Type.Object(
        {
            target: Type.String({
                description: "Agent id to message (from spawn_agent).",
            }),
            message: Type.Optional(
                Type.String({
                    description:
                        "Legacy plain-text message to send to the agent. Use either message or items.",
                }),
            ),
            items: Type.Optional(collaborationItemsSchema),
            interrupt: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
    ),
    returnType: Type.Object({
        submission_id: Type.String({
            description: "Identifier for the queued input submission.",
        }),
    }),
    shouldReviewInAutoMode: () => false,
    execute: (args, context, execution) => {
        const message = [args.message, collaborationItemsToText(args.items)]
            .filter((value): value is string => value !== undefined && value.length > 0)
            .join("\n");
        if (message.length === 0) throw new Error("send_input requires message or items.");
        const subagents = requireSubagentContext(context);
        if (args.interrupt === true) {
            subagents.interrupt(args.target);
            subagents.followUp(args.target, message);
        } else {
            const sendMessage = subagents.sendMessage;
            if (sendMessage === undefined) subagents.followUp(args.target, message);
            else sendMessage(args.target, message);
        }
        return { submission_id: execution.toolCallId ?? args.target };
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: () => "Sent input to the subagent.",
    locks: [],
});
