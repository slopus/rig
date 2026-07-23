import { Type } from "@sinclair/typebox";

import { defineTool } from "../../../types.js";
import { managedSubagentSchema } from "../impl/subagentSchemas.js";
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
    returnType: managedSubagentSchema,
    shouldReviewInAutoMode: () => false,
    execute: (args, context) => {
        const message = [args.message, collaborationItemsToText(args.items)]
            .filter((value): value is string => value !== undefined && value.length > 0)
            .join("\n");
        if (message.length === 0) throw new Error("send_input requires message or items.");
        const subagents = requireSubagentContext(context);
        if (args.interrupt === true) {
            subagents.interrupt(args.target);
            return subagents.followUp(args.target, message);
        }
        const sendMessage = subagents.sendMessage;
        return sendMessage === undefined
            ? subagents.followUp(args.target, message)
            : sendMessage(args.target, message);
    },
    toLLM: (result) => [{ type: "text", text: JSON.stringify(result) }],
    toUI: (result) => `Sent input to ${result.description}.`,
    locks: [],
});
